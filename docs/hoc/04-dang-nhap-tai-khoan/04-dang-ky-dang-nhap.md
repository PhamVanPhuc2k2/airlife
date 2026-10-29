# Bài 4.04: Đăng ký, đăng nhập, chặn dò mật khẩu

> [← Bài trước](03-access-va-refresh-token.md) · [Mục lục](../README.md) · [Bài sau →](05-cookie-middleware-csrf.md)

## Mục tiêu

`internal/auth/service.go`: đăng ký, đăng nhập, làm mới, đăng xuất, lấy tài khoản hiện tại.

## Bạn sẽ học

- Không để lộ "email này có tài khoản không" (user enumeration), kể cả qua **thời gian phản hồi**.
- Chặn dò mật khẩu theo email và theo IP bằng bộ đếm Redis.
- Để database chặn trùng (`UNIQUE`) thay vì "SELECT rồi INSERT".

## Viết code

### `backend/internal/auth/service.go`

```go
package auth

import (
	"context"
	"errors"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/password"
)

// Chặn dò mật khẩu: đếm số lần sai trong một khoảng thời gian, theo IP và theo email.
//   - Theo email: chặn dò MỘT tài khoản từ nhiều IP.
//   - Theo IP: chặn một máy thử mật khẩu trên NHIỀU tài khoản.
const (
	failWindow      = 15 * time.Minute
	maxFailPerEmail = 5
	maxFailPerIP    = 20
	maxRegisterIP   = 10 // số tài khoản tạo được từ một IP mỗi giờ
)

var (
	// Cùng một câu cho "sai email" và "sai mật khẩu": nói rõ "email không tồn tại" là giúp kẻ
	// gian biết email nào có tài khoản (user enumeration).
	errInvalidCredentials = apperr.Unauthorized("invalid_credentials", "Email hoặc mật khẩu không đúng")
	errTooManyAttempts    = apperr.TooMany("too_many_attempts", "Bạn thử sai quá nhiều lần, vui lòng thử lại sau 15 phút")
	errAccountLocked      = apperr.Forbidden("account_locked", "Tài khoản đang bị khoá")
)

type User struct {
	ID            uuid.UUID `json:"id"`
	Email         string    `json:"email"`
	DisplayName   string    `json:"display_name"`
	AvatarURL     *string   `json:"avatar_url"`
	Role          string    `json:"role"`
	EmailVerified bool      `json:"email_verified"`
	CreatedAt     time.Time `json:"created_at"`
}

// Session: kết quả đăng nhập/làm mới, handler đặt vào cookie.
type Session struct {
	User         User
	AccessToken  string
	RefreshToken string
}

type Service struct {
	q        *db.Queries
	rdb      *redis.Client
	tokens   *TokenIssuer
	sessions *Sessions
	// Mã băm giả để so khi email không tồn tại (xem Login)
	dummyHash string
}

func NewService(q *db.Queries, rdb *redis.Client, tokens *TokenIssuer, sessions *Sessions) (*Service, error) {
	dummy, err := password.Hash("airlife-dummy-password")
	if err != nil {
		return nil, err
	}
	return &Service{q: q, rdb: rdb, tokens: tokens, sessions: sessions, dummyHash: dummy}, nil
}

type RegisterInput struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
}

func (s *Service) Register(ctx context.Context, in RegisterInput, ip string) (Session, error) {
	in.Email = normalizeEmail(in.Email)
	in.DisplayName = strings.TrimSpace(in.DisplayName)
	if err := validateRegister(in); err != nil {
		return Session{}, err
	}
	if err := s.limit(ctx, "auth:register:ip:"+ip, maxRegisterIP); err != nil {
		return Session{}, err
	}

	hash, err := password.Hash(in.Password)
	if err != nil {
		return Session{}, err
	}
	row, err := s.q.CreateUser(ctx, db.CreateUserParams{
		Email: in.Email, PasswordHash: hash, DisplayName: in.DisplayName,
	})
	// 23505 = unique_violation: email đã có. Để database chặn (UNIQUE) thay vì "SELECT kiểm tra
	// rồi mới INSERT": hai request đăng ký cùng email cùng lúc đều qua bước SELECT được.
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return Session{}, apperr.Conflict("email_taken", "Email này đã được đăng ký").
			WithFields(map[string]string{"email": "Email này đã được đăng ký"})
	}
	if err != nil {
		return Session{}, err
	}
	s.bump(ctx, "auth:register:ip:"+ip, time.Hour)

	user := User{
		ID: row.ID, Email: row.Email, DisplayName: row.DisplayName, AvatarURL: row.AvatarUrl,
		Role: row.Role, EmailVerified: row.EmailVerifiedAt != nil, CreatedAt: row.CreatedAt,
	}
	return s.openSession(ctx, user)
}

func (s *Service) Login(ctx context.Context, email, plain, ip string) (Session, error) {
	email = normalizeEmail(email)
	emailKey, ipKey := "auth:fail:email:"+email, "auth:fail:ip:"+ip
	if err := s.limit(ctx, emailKey, maxFailPerEmail); err != nil {
		return Session{}, err
	}
	if err := s.limit(ctx, ipKey, maxFailPerIP); err != nil {
		return Session{}, err
	}

	row, err := s.q.GetUserForLogin(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		// Email không tồn tại vẫn chạy argon2 một lần với mã băm giả. Không làm thế thì "sai
		// email" trả lời ngay (vài ms) còn "sai mật khẩu" mất ~50 ms: đo thời gian là biết email
		// nào có tài khoản (timing attack).
		_, _ = password.Verify(plain, s.dummyHash)
		s.bump(ctx, emailKey, failWindow)
		s.bump(ctx, ipKey, failWindow)
		return Session{}, errInvalidCredentials
	}
	if err != nil {
		return Session{}, err
	}
	ok, err := password.Verify(plain, row.PasswordHash)
	if err != nil {
		return Session{}, err
	}
	if !ok {
		s.bump(ctx, emailKey, failWindow)
		s.bump(ctx, ipKey, failWindow)
		return Session{}, errInvalidCredentials
	}
	if row.Status != "active" {
		return Session{}, errAccountLocked
	}

	s.rdb.Del(ctx, emailKey) // đăng nhập đúng: xoá bộ đếm sai của email này
	if err := s.q.TouchLastLogin(ctx, row.ID); err != nil {
		return Session{}, err
	}
	user, err := s.Me(ctx, row.ID)
	if err != nil {
		return Session{}, err
	}
	return s.openSession(ctx, user)
}

// Refresh: đổi refresh token lấy cặp token mới. Đọc lại user từ database để vai trò mới đổi,
// hay tài khoản vừa bị khoá, có hiệu lực ngay ở lần làm mới tiếp theo.
func (s *Service) Refresh(ctx context.Context, refreshToken string) (Session, error) {
	userID, newRefresh, err := s.sessions.Rotate(ctx, refreshToken)
	if err != nil {
		return Session{}, err
	}
	user, status, err := s.load(ctx, userID)
	if err != nil {
		return Session{}, err
	}
	if status != "active" {
		_ = s.sessions.Revoke(ctx, newRefresh)
		return Session{}, errAccountLocked
	}
	access, err := s.tokens.Issue(user.ID, user.Role)
	if err != nil {
		return Session{}, err
	}
	return Session{User: user, AccessToken: access, RefreshToken: newRefresh}, nil
}

func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	if refreshToken == "" {
		return nil
	}
	return s.sessions.Revoke(ctx, refreshToken)
}

func (s *Service) Me(ctx context.Context, id uuid.UUID) (User, error) {
	u, _, err := s.load(ctx, id)
	return u, err
}

// load đọc tài khoản kèm trạng thái (active/locked).
func (s *Service) load(ctx context.Context, id uuid.UUID) (User, string, error) {
	r, err := s.q.GetUserByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, "", errUnauthorized // token hợp lệ nhưng tài khoản đã bị xoá
	}
	if err != nil {
		return User{}, "", err
	}
	return User{
		ID: r.ID, Email: r.Email, DisplayName: r.DisplayName, AvatarURL: r.AvatarUrl,
		Role: r.Role, EmailVerified: r.EmailVerifiedAt != nil, CreatedAt: r.CreatedAt,
	}, r.Status, nil
}

func (s *Service) openSession(ctx context.Context, user User) (Session, error) {
	refresh, err := s.sessions.Create(ctx, user.ID)
	if err != nil {
		return Session{}, err
	}
	access, err := s.tokens.Issue(user.ID, user.Role)
	if err != nil {
		return Session{}, err
	}
	return Session{User: user, AccessToken: access, RefreshToken: refresh}, nil
}

// limit: bộ đếm đã chạm maxCount thì chặn (bộ đếm tự hết hạn, xem bump).
func (s *Service) limit(ctx context.Context, key string, maxCount int64) error {
	n, err := s.rdb.Get(ctx, key).Int64()
	if err != nil && !errors.Is(err, redis.Nil) {
		return err
	}
	if n >= maxCount {
		return errTooManyAttempts
	}
	return nil
}

// bump: tăng bộ đếm; lần đầu thì đặt hạn (ExpireNX: chỉ đặt khi khoá chưa có hạn), để cửa sổ
// tính từ lần sai ĐẦU TIÊN, không bị kéo dài mãi mỗi lần sai.
func (s *Service) bump(ctx context.Context, key string, window time.Duration) {
	pipe := s.rdb.TxPipeline()
	pipe.Incr(ctx, key)
	pipe.ExpireNX(ctx, key, window)
	_, _ = pipe.Exec(ctx) // lỗi đếm không được chặn người dùng thật
}

func normalizeEmail(e string) string {
	return strings.ToLower(strings.TrimSpace(e))
}

func validateRegister(in RegisterInput) error {
	fields := map[string]string{}
	if addr, err := mail.ParseAddress(in.Email); err != nil || addr.Address != in.Email || len(in.Email) > 254 {
		fields["email"] = "Email không hợp lệ"
	}
	switch n := utf8.RuneCountInString(in.Password); {
	case n < 8:
		fields["password"] = "Mật khẩu cần ít nhất 8 ký tự"
	case n > 128:
		fields["password"] = "Mật khẩu tối đa 128 ký tự"
	}
	if n := utf8.RuneCountInString(in.DisplayName); n < 2 || n > 50 {
		fields["display_name"] = "Tên hiển thị từ 2 đến 50 ký tự"
	}
	if len(fields) > 0 {
		return apperr.Invalid("validation_failed", "Thông tin chưa hợp lệ").WithFields(fields)
	}
	return nil
}
```

Điểm chính:

- **Cùng một thông báo** cho sai email và sai mật khẩu. Nhưng chỉ vậy chưa đủ: email không tồn tại
  trả lời trong vài ms, còn email có thật mất ~50 ms (argon2 chạy). Đo thời gian là đoán được. Vì vậy
  nhánh "không có email" vẫn chạy argon2 một lần với **mã băm giả** (`dummyHash`).
- **Hai bộ đếm**: theo email (5 lần / 15 phút) chặn dò một tài khoản từ nhiều máy; theo IP (20 lần)
  chặn một máy thử nhiều tài khoản. Kiểm tra **trước** khi chạy argon2, nên kẻ gian cũng không làm API
  tốn CPU được.
- **`ExpireNX`**: chỉ đặt hạn khi khoá chưa có hạn. Cửa sổ 15 phút tính từ lần sai **đầu tiên**; nếu
  đặt lại hạn mỗi lần sai thì người gõ sai liên tục bị khoá mãi.
- **Đăng nhập đúng thì xoá bộ đếm của email**, không xoá bộ đếm IP (kẻ gian có một tài khoản thật không
  được dùng nó để "rửa" bộ đếm IP).
- **`pgErr.Code == "23505"`**: lỗi `unique_violation` của PostgreSQL → 409 `email_taken`. Kiểm tra
  "email đã có chưa" bằng SELECT trước rồi mới INSERT thì hai request cùng lúc đều qua được SELECT.
- **`Refresh` đọc lại user** từ database: tài khoản vừa bị khoá thì lần làm mới tiếp theo (tối đa 15
  phút) bị chặn, và phiên bị thu hồi.
- **`validateRegister`** trả `Fields`: frontend gắn lỗi vào đúng ô (bài 4.07).

## Kiểm tra

```bash
cd backend && go build ./... && cd .. && make lint
git add . && git commit -m "Đăng ký, đăng nhập, chặn dò mật khẩu"
```

Thử thật ở bài 4.05.

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| Thử đăng nhập lúc dev bị `too_many_attempts` | Xoá bộ đếm: `docker compose exec redis redis-cli -a airlife --no-auth-warning --scan --pattern 'auth:fail:*' \| xargs docker compose exec -T redis redis-cli -a airlife --no-auth-warning DEL` |
| Email `Abc@x.com` đăng nhập không được dù đăng ký bằng `abc@x.com` | Quên `normalizeEmail` ở một trong hai chỗ (cột `citext` vẫn so đúng, nhưng khoá bộ đếm Redis thì phân biệt) |
