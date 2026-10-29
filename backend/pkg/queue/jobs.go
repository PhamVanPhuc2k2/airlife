package queue

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

// Hàng đợi job, mỗi loại job có 3 queue:
//
//	<tên>        queue chính: API gửi job vào, worker lấy ra xử lý
//	<tên>.retry  xử lý lỗi → job vào đây, nằm chờ retryDelay rồi tự quay về queue chính
//	             (x-message-ttl + x-dead-letter: hết hạn thì RabbitMQ chuyển tiếp)
//	<tên>.dead   lỗi quá maxAttempts lần → nằm đây để người xem lại (trang quản trị RabbitMQ)
//
// Vì sao không thử lại ngay: lỗi thường do bên ngoài tạm hỏng (máy chủ mail chập chờn). Thử lại
// liền 5 lần trong 1 giây thì cả 5 lần đều hỏng; chờ 30 giây thì thường đã ổn.
//
// Gửi qua exchange mặc định (""): routing key chính là tên queue, không cần khai báo exchange riêng.

const (
	retryDelay  = 30 * time.Second
	maxAttempts = 5
	attemptHdr  = "x-attempt"
)

// DeclareJobQueue tạo 3 queue của một loại job. Gọi lại nhiều lần không sao (đã có thì giữ nguyên),
// nên cả API (bên gửi) và worker (bên nhận) đều gọi lúc khởi động, không phụ thuộc ai chạy trước.
func DeclareJobQueue(conn *amqp.Connection, name string) error {
	ch, err := conn.Channel()
	if err != nil {
		return err
	}
	defer func() { _ = ch.Close() }()

	// durable: queue còn sau khi RabbitMQ khởi động lại
	if _, err := ch.QueueDeclare(name+".dead", true, false, false, false, nil); err != nil {
		return fmt.Errorf("khai báo %s.dead: %w", name, err)
	}
	if _, err := ch.QueueDeclare(name+".retry", true, false, false, false, amqp.Table{
		"x-message-ttl":             retryDelay.Milliseconds(),
		"x-dead-letter-exchange":    "",
		"x-dead-letter-routing-key": name,
	}); err != nil {
		return fmt.Errorf("khai báo %s.retry: %w", name, err)
	}
	if _, err := ch.QueueDeclare(name, true, false, false, false, amqp.Table{
		// Job bị từ chối (Nack, không requeue) → chuyển sang .dead
		"x-dead-letter-exchange":    "",
		"x-dead-letter-routing-key": name + ".dead",
	}); err != nil {
		return fmt.Errorf("khai báo %s: %w", name, err)
	}
	return nil
}

// Publisher gửi job, CHỜ RabbitMQ xác nhận đã nhận (publisher confirms). Không chờ thì job có
// thể mất (RabbitMQ đang khởi động lại) mà API vẫn tưởng đã gửi xong.
type Publisher struct {
	mu sync.Mutex // một channel AMQP không nên gửi đồng thời từ nhiều goroutine
	ch *amqp.Channel
}

func NewPublisher(conn *amqp.Connection) (*Publisher, error) {
	ch, err := conn.Channel()
	if err != nil {
		return nil, err
	}
	if err := ch.Confirm(false); err != nil {
		return nil, fmt.Errorf("bật publisher confirms: %w", err)
	}
	return &Publisher{ch: ch}, nil
}

func (p *Publisher) Publish(ctx context.Context, queueName string, job any) error {
	body, err := json.Marshal(job)
	if err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	confirm, err := p.ch.PublishWithDeferredConfirmWithContext(ctx, "", queueName, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent, // ghi xuống đĩa: còn sau khi RabbitMQ khởi động lại
		Timestamp:    time.Now(),
		Body:         body,
	})
	if err != nil {
		return err
	}
	ok, err := confirm.WaitContext(ctx)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("rabbitmq từ chối job")
	}
	return nil
}

// Handler xử lý một job. Trả lỗi = thử lại sau (tối đa maxAttempts lần).
type Handler func(ctx context.Context, body []byte) error

// Consume nhận job của một queue cho tới khi ctx bị huỷ.
func Consume(ctx context.Context, conn *amqp.Connection, queueName string, prefetch int, log *slog.Logger, h Handler) error {
	ch, err := conn.Channel()
	if err != nil {
		return err
	}
	defer func() { _ = ch.Close() }()
	// prefetch: RabbitMQ chỉ giao tối đa ngần này job chưa ack cho worker. Không đặt thì nó dồn
	// hết hàng nghìn job vào một worker, các worker khác (khi chạy nhiều bản) ngồi chơi.
	if err := ch.Qos(prefetch, 0, false); err != nil {
		return err
	}
	// autoAck = false: chỉ báo "xong" (Ack) SAU KHI xử lý thành công. Worker chết giữa chừng thì
	// job chưa ack quay lại queue, không mất.
	deliveries, err := ch.ConsumeWithContext(ctx, queueName, "", false, false, false, false, nil)
	if err != nil {
		return err
	}
	log.Info("đang nhận job", "queue", queueName)

	for d := range deliveries {
		attempt := attemptOf(d) + 1
		jobErr := h(ctx, d.Body)
		switch {
		case jobErr == nil:
			_ = d.Ack(false)
		case attempt < maxAttempts:
			log.Warn("job lỗi, thử lại sau", "queue", queueName, "attempt", attempt, "err", jobErr)
			if err := ch.PublishWithContext(ctx, "", queueName+".retry", false, false, amqp.Publishing{
				ContentType:  d.ContentType,
				DeliveryMode: amqp.Persistent,
				Headers:      amqp.Table{attemptHdr: attempt},
				Body:         d.Body,
			}); err != nil {
				_ = d.Nack(false, true) // gửi sang .retry hỏng: trả lại queue chính, thử ngay
				continue
			}
			_ = d.Ack(false)
		default:
			log.Error("job lỗi quá số lần thử, chuyển sang .dead", "queue", queueName, "attempt", attempt, "err", jobErr)
			_ = d.Nack(false, false) // không requeue → dead-letter sang .dead
		}
	}
	if ctx.Err() != nil {
		return nil // tắt worker bình thường
	}
	return errors.New("kênh nhận job bị đóng")
}

// attemptOf: số lần đã thử của job (header x-attempt, int32 như lúc ghi vào)
func attemptOf(d amqp.Delivery) int32 {
	if v, ok := d.Headers[attemptHdr].(int32); ok {
		return v
	}
	return 0
}
