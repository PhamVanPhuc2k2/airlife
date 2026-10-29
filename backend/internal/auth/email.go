package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"log/slog"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/mail"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/password"
)

// Xác minh email và quên mật khẩu: cùng một cơ chế "token một lần dùng gửi qua email".
//
//   auth:verify:<băm token> → user_id   sống 24 giờ
//   auth:reset:<băm token>  → user_id   sống 30 phút (quyền đổi mật khẩu: càng ngắn càng an toàn)
//
// Như refresh token: Redis chỉ giữ bản băm; GETDEL nên mỗi token chỉ dùng được MỘT lần.

const (
	verifyTTL = 24 * time.Hour
	resetTTL  = 30 * time.Minute
)

var errInvalidLink = apperr.Invalid("invalid_token", "Liên kết không hợp lệ hoặc đã hết hạn")

// Publisher: thứ đẩy được job vào hàng đợi (queue.Publisher). Khai báo interface ở bên DÙNG,
// gói auth không phụ thuộc trực tiếp vào RabbitMQ.
type Publisher interface {
	Publish(ctx context.Context, queueName string, job any) error
}

// sendVerifyEmail tạo token xác minh và đẩy job gửi mail.
func (s *Service) sendVerifyEmail(ctx context.Context, u User) error {
	token, err := s.oneTimeToken(ctx, "auth:verify:", u.ID, verifyTTL)
	if err != nil {
		return err
	}
	return s.mail.Publish(ctx, mail.Queue, mail.Job{
		Template: mail.TemplateVerifyEmail,
		To:       u.Email,
		Data:     map[string]string{"name": u.DisplayName, "link": s.publicURL + "/xac-minh-email?token=" + token},
	})
}

// ResendVerifyEmail: người dùng bấm "Gửi lại email xác minh".
func (s *Service) ResendVerifyEmail(ctx context.Context, userID uuid.UUID) error {
	u, err := s.Me(ctx, userID)
	if err != nil {
		return err
	}
	if u.EmailVerified {
		return apperr.Conflict("already_verified", "Email đã được xác minh")
	}
	key := "auth:verify-sent:" + userID.String()
	if err := s.limit(ctx, key, 3); err != nil { // tối đa 3 thư/giờ: chặn dùng Airlife để spam
		return err
	}
	s.bump(ctx, key, time.Hour)
	return s.sendVerifyEmail(ctx, u)
}

func (s *Service) VerifyEmail(ctx context.Context, token string) error {
	userID, err := s.useToken(ctx, "auth:verify:", token)
	if err != nil {
		return err
	}
	return s.q.SetEmailVerified(ctx, userID)
}

// ForgotPassword LUÔN trả nil (handler trả 204) dù email có tài khoản hay không: trả lời khác
// nhau là để lộ email nào đã đăng ký (bài 4.04).
func (s *Service) ForgotPassword(ctx context.Context, email, ip string) error {
	email = normalizeEmail(email)
	ipKey, emailKey := "auth:forgot:ip:"+ip, "auth:forgot:email:"+email
	if err := s.limit(ctx, ipKey, 10); err != nil {
		return err
	}
	s.bump(ctx, ipKey, time.Hour)
	// Theo email: im lặng bỏ qua (không báo lỗi), để không ai dùng form này dội thư vào hộp mail
	// người khác, mà cũng không lộ gì.
	if s.limit(ctx, emailKey, 3) != nil {
		return nil
	}
	s.bump(ctx, emailKey, time.Hour)

	row, err := s.q.GetUserForLogin(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if row.Status != "active" {
		return nil
	}
	token, err := s.oneTimeToken(ctx, "auth:reset:", row.ID, resetTTL)
	if err != nil {
		return err
	}
	return s.mail.Publish(ctx, mail.Queue, mail.Job{
		Template: mail.TemplateResetPassword,
		To:       row.Email,
		Data:     map[string]string{"name": row.DisplayName, "link": s.publicURL + "/dat-lai-mat-khau?token=" + token},
	})
}

func (s *Service) ResetPassword(ctx context.Context, token, newPassword string) error {
	if n := utf8.RuneCountInString(newPassword); n < 8 || n > 128 {
		return apperr.Invalid("validation_failed", "Thông tin chưa hợp lệ").
			WithFields(map[string]string{"password": "Mật khẩu từ 8 đến 128 ký tự"}) //nolint:gosec // G101 báo nhầm: thông báo lỗi
	}
	userID, err := s.useToken(ctx, "auth:reset:", token)
	if err != nil {
		return err
	}
	hash, err := password.Hash(newPassword)
	if err != nil {
		return err
	}
	if err := s.q.UpdatePassword(ctx, db.UpdatePasswordParams{ID: userID, PasswordHash: hash}); err != nil {
		return err
	}
	// Người quên mật khẩu có thể vì bị lộ mật khẩu: đăng xuất mọi nơi đang đăng nhập bằng mật khẩu cũ
	return s.sessions.RevokeAllForUser(ctx, userID)
}

func (s *Service) oneTimeToken(ctx context.Context, prefix string, userID uuid.UUID, ttl time.Duration) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	if err := s.rdb.Set(ctx, prefix+hashToken(token), userID.String(), ttl).Err(); err != nil {
		return "", err
	}
	return token, nil
}

func (s *Service) useToken(ctx context.Context, prefix, token string) (uuid.UUID, error) {
	if token == "" {
		return uuid.Nil, errInvalidLink
	}
	val, err := s.rdb.GetDel(ctx, prefix+hashToken(token)).Result()
	if errors.Is(err, redis.Nil) {
		return uuid.Nil, errInvalidLink
	}
	if err != nil {
		return uuid.Nil, err
	}
	id, err := uuid.Parse(val)
	if err != nil {
		return uuid.Nil, errInvalidLink
	}
	return id, nil
}

// afterRegister gửi mail xác minh. Hỏng thì chỉ ghi log, KHÔNG làm hỏng việc đăng ký: tài khoản
// đã tạo xong, người dùng bấm "Gửi lại email xác minh" ở trang Bạn được.
func (s *Service) afterRegister(ctx context.Context, u User) {
	if err := s.sendVerifyEmail(ctx, u); err != nil {
		slog.ErrorContext(ctx, "gửi mail xác minh sau đăng ký lỗi", "user_id", u.ID, "err", err)
	}
}
