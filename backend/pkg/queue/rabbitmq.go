// Package queue kết nối RabbitMQ bằng amqp091-go (thư viện chính thức của RabbitMQ).
//
// Bản khởi đầu chỉ mở kết nối. Publisher, consumer, retry và dead-letter queue
// được thêm ở phần gửi email (job đầu tiên của worker).
package queue

import (
	"fmt"

	amqp "github.com/rabbitmq/amqp091-go"
)

func NewRabbitMQ(url string) (*amqp.Connection, error) {
	conn, err := amqp.Dial(url)
	if err != nil {
		// Không in url: chứa user/mật khẩu.
		return nil, fmt.Errorf("kết nối rabbitmq: %w", err)
	}
	return conn, nil
}
