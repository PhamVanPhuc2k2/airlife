# Bài 4.11: Xác minh email và quên mật khẩu (backend)

> [← Bài trước](10-gui-mail-o-worker.md) · [Mục lục](../README.md) · [Bài sau →](12-frontend-xac-minh-dat-lai.md)

## Mục tiêu

API `/auth/verify-email`, `/auth/verify-email/resend`, `/auth/forgot-password`, `/auth/reset-password`.
Đăng ký xong tự gửi thư xác minh; đặt lại mật khẩu xong đăng xuất mọi thiết bị.

## Bạn sẽ học

- Token dùng một lần qua email (cùng cơ chế với refresh token: lưu bản băm, `GETDEL`).
- "Quên mật khẩu" không được lộ email nào đã đăng ký.
- Kiểm tra dữ liệu **trước** khi dùng token, để lỗi nhập liệu không đốt mất token.
- Khai báo interface ở phía **dùng**.

## Viết code

### Bước 1: Truy vấn

Thêm vào cuối `backend/internal/db/queries/users.sql`:

```sql
-- Chỉ đặt khi chưa xác minh: bấm lại link cũ không làm đổi thời điểm xác minh.
-- name: SetEmailVerified :exec
UPDATE users SET email_verified_at = now(), updated_at = now()
WHERE id = $1 AND email_verified_at IS NULL;

-- name: UpdatePassword :exec
UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1;
```

```bash
make sqlc
```

### Bước 2: "Đăng xuất mọi thiết bị", `backend/internal/auth/sessions.go`

Mỗi phiên mới ghi family của nó vào tập `auth:ufam:<user_id>`; `RevokeAllForUser` thu hồi hết. Bản đầy đủ:

```go
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
)

// Refresh token lưu trong Redis, XOAY VÒNG: mỗi lần dùng để xin access token mới thì token cũ
// bị huỷ và cấp token mới. Các token nối tiếp nhau từ một lần đăng nhập thuộc cùng một "họ"
// (family).
//
// Phát hiện bị đánh cắp: token cũ đã đổi rồi mà vẫn có người gửi lên, nghĩa là có HAI bên đang
// giữ token này (người dùng và kẻ gian). Không biết bên nào thật, nên thu hồi cả họ: cả hai
// cùng phải đăng nhập lại, và kẻ gian mất quyền truy cập.
//
// Khoá Redis:
//   auth:rt:<băm token>      → "<user_id>|<family>"     token còn hiệu lực
//   auth:fam:<family>        → tập các băm token của họ   để thu hồi cả họ
//   auth:used:<băm token>    → "<family>|<unix>"         token đã đổi, nhớ lại để bắt tái sử dụng
//   auth:ufam:<user_id>      → tập các family của user    để "đăng xuất mọi thiết bị"
//
// Chỉ lưu BẢN BĂM sha256 của token: ai đọc được Redis cũng không có token để dùng.

var (
	errRefreshInvalid = apperr.Unauthorized("refresh_invalid", "Phiên đăng nhập không còn hiệu lực")
	errSessionRevoked = apperr.Unauthorized("session_revoked", "Phiên đăng nhập đã bị thu hồi vì lý do an toàn")
	// Hai tab cùng làm mới gần như một lúc: tab sau gửi token tab trước vừa đổi. Không phải bị
	// đánh cắp; frontend thử lại request (cookie đã là token mới do tab kia nhận về).
	errRefreshRace = apperr.Unauthorized("refresh_race", "Phiên vừa được làm mới, vui lòng thử lại")
)

// Khoảng thời gian coi việc gửi lại token vừa đổi là "hai tab tranh nhau", không phải đánh cắp.
const raceGrace = 10 * time.Second

type Sessions struct {
	rdb *redis.Client
	ttl time.Duration
}

func NewSessions(rdb *redis.Client, ttl time.Duration) *Sessions {
	return &Sessions{rdb: rdb, ttl: ttl}
}

// Create mở phiên mới (đăng nhập, đăng ký), trả refresh token gốc để đặt vào cookie.
func (s *Sessions) Create(ctx context.Context, userID uuid.UUID) (string, error) {
	family := uuid.NewString()
	pipe := s.rdb.TxPipeline()
	pipe.SAdd(ctx, "auth:ufam:"+userID.String(), family)
	pipe.Expire(ctx, "auth:ufam:"+userID.String(), s.ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		return "", err
	}
	return s.issue(ctx, userID, family)
}

// RevokeAllForUser: đăng xuất mọi thiết bị (sau khi đặt lại mật khẩu). Ai đang giữ phiên cũ,
// kể cả kẻ đã biết mật khẩu cũ, đều mất quyền ngay khi access token 15 phút hết hạn.
func (s *Sessions) RevokeAllForUser(ctx context.Context, userID uuid.UUID) error {
	key := "auth:ufam:" + userID.String()
	families, err := s.rdb.SMembers(ctx, key).Result()
	if err != nil {
		return err
	}
	for _, f := range families {
		if err := s.revokeFamily(ctx, f); err != nil {
			return err
		}
	}
	return s.rdb.Del(ctx, key).Err()
}

// Rotate đổi refresh token cũ lấy token mới. Trả user_id của phiên.
func (s *Sessions) Rotate(ctx context.Context, old string) (uuid.UUID, string, error) {
	h := hashToken(old)
	// GETDEL: lấy và xoá trong một lệnh. Hai request cùng gửi một token thì chỉ MỘT request
	// lấy được, request kia rơi vào nhánh "đã dùng" bên dưới.
	val, err := s.rdb.GetDel(ctx, "auth:rt:"+h).Result()
	if errors.Is(err, redis.Nil) {
		return uuid.Nil, "", s.checkReuse(ctx, h)
	}
	if err != nil {
		return uuid.Nil, "", err
	}
	userID, family, err := splitSession(val)
	if err != nil {
		return uuid.Nil, "", err
	}
	newToken, err := s.issue(ctx, userID, family)
	if err != nil {
		return uuid.Nil, "", err
	}
	pipe := s.rdb.TxPipeline()
	pipe.SRem(ctx, "auth:fam:"+family, h)
	pipe.Set(ctx, "auth:used:"+h, family+"|"+strconv.FormatInt(time.Now().Unix(), 10), s.ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		return uuid.Nil, "", err
	}
	return userID, newToken, nil
}

// Revoke: đăng xuất, thu hồi cả họ token của phiên này.
func (s *Sessions) Revoke(ctx context.Context, token string) error {
	val, err := s.rdb.GetDel(ctx, "auth:rt:"+hashToken(token)).Result()
	if errors.Is(err, redis.Nil) {
		return nil // đã hết hạn hoặc đã đăng xuất: coi như xong
	}
	if err != nil {
		return err
	}
	_, family, err := splitSession(val)
	if err != nil {
		return err
	}
	return s.revokeFamily(ctx, family)
}

func (s *Sessions) issue(ctx context.Context, userID uuid.UUID, family string) (string, error) {
	b := make([]byte, 32) // 256 bit ngẫu nhiên: không thể đoán
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	h := hashToken(token)
	pipe := s.rdb.TxPipeline()
	pipe.Set(ctx, "auth:rt:"+h, userID.String()+"|"+family, s.ttl)
	pipe.SAdd(ctx, "auth:fam:"+family, h)
	pipe.Expire(ctx, "auth:fam:"+family, s.ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		return "", err
	}
	return token, nil
}

func (s *Sessions) checkReuse(ctx context.Context, h string) error {
	used, err := s.rdb.Get(ctx, "auth:used:"+h).Result()
	if errors.Is(err, redis.Nil) {
		return errRefreshInvalid // token lạ hoặc đã hết hạn
	}
	if err != nil {
		return err
	}
	family, at, _ := strings.Cut(used, "|")
	unix, _ := strconv.ParseInt(at, 10, 64)
	if time.Since(time.Unix(unix, 0)) < raceGrace {
		return errRefreshRace
	}
	if err := s.revokeFamily(ctx, family); err != nil {
		return err
	}
	return errSessionRevoked
}

func (s *Sessions) revokeFamily(ctx context.Context, family string) error {
	hashes, err := s.rdb.SMembers(ctx, "auth:fam:"+family).Result()
	if err != nil {
		return err
	}
	keys := make([]string, 0, len(hashes)+1)
	for _, h := range hashes {
		keys = append(keys, "auth:rt:"+h)
	}
	keys = append(keys, "auth:fam:"+family)
	return s.rdb.Del(ctx, keys...).Err()
}

func hashToken(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

func splitSession(val string) (uuid.UUID, string, error) {
	idStr, family, ok := strings.Cut(val, "|")
	id, err := uuid.Parse(idStr)
	if !ok || err != nil {
		return uuid.Nil, "", fmt.Errorf("phiên trong Redis sai định dạng: %q", val)
	}
	return id, family, nil
}
```

### Bước 3: `backend/internal/auth/email.go`

```go
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
```

- **`Publisher` là interface khai báo trong gói `auth`**: gói `auth` không import RabbitMQ; ai có hàm
  `Publish` là dùng được (sau này đổi hàng đợi khác, hay truyền bản giả khi thử, không phải sửa `auth`).
- **`ForgotPassword` luôn `nil`**: dù email có hay không, API đều trả 204 và frontend hiện cùng một câu.
  Giới hạn theo email thì **im lặng** bỏ qua: không ai dùng form này dội thư vào hộp mail người khác được.
- **`ResetPassword` kiểm tra độ dài mật khẩu TRƯỚC `useToken`**: nếu dùng token trước, khách gõ mật khẩu
  quá ngắn thì token đã bị đốt và phải xin link mới.
- **Đăng ký không lỗi vì gửi mail lỗi** (`afterRegister` chỉ ghi log): tài khoản đã tạo; khách bấm "Gửi
  lại email xác minh".

### Bước 4: `service.go` và `handler.go`

`NewService` nhận thêm `mail Publisher, publicURL string`; `Register` gọi `s.afterRegister(ctx, user)`.
Bản đầy đủ `backend/internal/auth/service.go`:

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
	mail     Publisher
	// Địa chỉ trang web, để ghép link trong email (email.go)
	publicURL string
	// Mã băm giả để so khi email không tồn tại (xem Login)
	dummyHash string
}

func NewService(
	q *db.Queries, rdb *redis.Client, tokens *TokenIssuer, sessions *Sessions,
	mail Publisher, publicURL string,
) (*Service, error) {
	dummy, err := password.Hash("airlife-dummy-password")
	if err != nil {
		return nil, err
	}
	return &Service{
		q: q, rdb: rdb, tokens: tokens, sessions: sessions,
		mail: mail, publicURL: publicURL, dummyHash: dummy,
	}, nil
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
	s.afterRegister(ctx, user)
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

Bốn handler mới trong `backend/internal/auth/handler.go`. `ResetPassword` xoá luôn cookie của trình duyệt
đang dùng (mọi phiên đã bị thu hồi). Bản đầy đủ:

```go
package auth

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/request"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

// Ba cookie:
//
//	al_access  access token (JWT). Path=/ : mọi request tới API đều gửi kèm.
//	al_refresh refresh token. Path=/api/v1/auth : trình duyệt CHỈ gửi kèm khi gọi API đăng nhập
//	           (refresh, logout); token sống lâu này không đi theo hàng trăm request khác.
//	al_session "1", KHÔNG HttpOnly: chỉ là dấu hiệu "đang có phiên" để frontend (và proxy của
//	           Next.js) biết mà không cần gọi API. Không chứa bí mật gì.
//
// HttpOnly: JavaScript không đọc được → lỗi XSS cũng không lấy được token.
// SameSite=Lax: trình duyệt không gửi cookie khi trang web KHÁC gửi form POST sang API → chặn
// phần lớn tấn công CSRF (thêm lớp kiểm tra Origin ở internal/server/middleware.go).
// Secure: chỉ gửi qua HTTPS. Tắt khi dev (http://localhost).
const (
	accessCookie  = "al_access"
	refreshCookie = "al_refresh"
	sessionCookie = "al_session"
	refreshPath   = "/api/v1/auth"
)

type CookieConfig struct {
	Domain     string
	Secure     bool
	AccessTTL  time.Duration
	RefreshTTL time.Duration
}

type Handler struct {
	svc      *Service
	log      *slog.Logger
	cookies  CookieConfig
	clientIP func(*http.Request) string
}

func NewHandler(svc *Service, log *slog.Logger, cookies CookieConfig, clientIP func(*http.Request) string) *Handler {
	return &Handler{svc: svc, log: log, cookies: cookies, clientIP: clientIP}
}

// POST /api/v1/auth/register {email, password, display_name}
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var in RegisterInput
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	sess, err := h.svc.Register(r.Context(), in, h.clientIP(r))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	h.setSession(w, sess)
	response.Created(w, sess.User)
}

// POST /api/v1/auth/login {email, password}
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	sess, err := h.svc.Login(r.Context(), in.Email, in.Password, h.clientIP(r))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	h.setSession(w, sess)
	response.OK(w, sess.User)
}

// POST /api/v1/auth/refresh — đọc cookie al_refresh, đặt cặp cookie mới
func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(refreshCookie)
	if err != nil {
		h.clearSession(w)
		response.Error(w, r, h.log, errRefreshInvalid)
		return
	}
	sess, err := h.svc.Refresh(r.Context(), c.Value)
	if err != nil {
		// refresh_race: KHÔNG xoá cookie, vì tab kia vừa đặt cookie mới hợp lệ
		if !errors.Is(err, errRefreshRace) {
			h.clearSession(w)
		}
		response.Error(w, r, h.log, err)
		return
	}
	h.setSession(w, sess)
	response.OK(w, sess.User)
}

// POST /api/v1/auth/logout
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(refreshCookie); err == nil {
		if err := h.svc.Logout(r.Context(), c.Value); err != nil {
			response.Error(w, r, h.log, err)
			return
		}
	}
	h.clearSession(w)
	response.NoContent(w)
}

// POST /api/v1/auth/verify-email {token} — bấm link trong email
func (h *Handler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token string `json:"token"`
	}
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	if err := h.svc.VerifyEmail(r.Context(), in.Token); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.NoContent(w)
}

// POST /api/v1/auth/verify-email/resend — cần đăng nhập
func (h *Handler) ResendVerifyEmail(w http.ResponseWriter, r *http.Request) {
	actor, _ := ActorFrom(r.Context())
	if err := h.svc.ResendVerifyEmail(r.Context(), actor.UserID); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.NoContent(w)
}

// POST /api/v1/auth/forgot-password {email} — luôn 204, kể cả khi email không có tài khoản
func (h *Handler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	if err := h.svc.ForgotPassword(r.Context(), in.Email, h.clientIP(r)); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.NoContent(w)
}

// POST /api/v1/auth/reset-password {token, password}
func (h *Handler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	if err := h.svc.ResetPassword(r.Context(), in.Token, in.Password); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	// Mọi phiên đã bị thu hồi; xoá luôn cookie của trình duyệt này (nếu có)
	h.clearSession(w)
	response.NoContent(w)
}

// GET /api/v1/auth/me — cần đăng nhập (RequireAuth)
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	actor, _ := ActorFrom(r.Context())
	u, err := h.svc.Me(r.Context(), actor.UserID)
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, u)
}

func (h *Handler) setSession(w http.ResponseWriter, s Session) {
	h.cookie(w, accessCookie, s.AccessToken, "/", h.cookies.AccessTTL, true)
	h.cookie(w, refreshCookie, s.RefreshToken, refreshPath, h.cookies.RefreshTTL, true)
	h.cookie(w, sessionCookie, "1", "/", h.cookies.RefreshTTL, false)
}

func (h *Handler) clearSession(w http.ResponseWriter) {
	// MaxAge âm = xoá cookie ngay. Path, Domain phải giống lúc đặt thì trình duyệt mới xoá đúng cookie.
	h.cookie(w, accessCookie, "", "/", -1, true)
	h.cookie(w, refreshCookie, "", refreshPath, -1, true)
	h.cookie(w, sessionCookie, "", "/", -1, false)
}

func (h *Handler) cookie(w http.ResponseWriter, name, value, path string, ttl time.Duration, httpOnly bool) {
	maxAge := int(ttl.Seconds())
	if ttl < 0 {
		maxAge = -1
	}
	// Secure/HttpOnly là biến có chủ đích: al_session cố ý không HttpOnly (chỉ là dấu hiệu, không
	// chứa bí mật), Secure chỉ tắt khi dev. Xem comment đầu file.
	http.SetCookie(w, &http.Cookie{ //nolint:gosec // G124: xem comment ngay trên
		Name:     name,
		Value:    value,
		Path:     path,
		Domain:   h.cookies.Domain,
		MaxAge:   maxAge,
		HttpOnly: httpOnly,
		Secure:   h.cookies.Secure,
		SameSite: http.SameSiteLaxMode,
	})
}
```

### Bước 5: Nối dây, `backend/internal/server/server.go`

```go
// Package server dựng router go-chi: middleware dùng chung, health check và các nhóm API.
//
// Mỗi module nghiệp vụ (media, product…) sẽ có handler riêng và được gắn vào
// nhóm /api/v1 trong Handler(). File này lớn dần qua các phần của khoá học.
package server

import (
	"fmt"
	"log/slog"
	"net/http"
	"net/netip"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/redis/go-redis/v9"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/auth"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/category"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/config"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/home"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/mail"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/media"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/news"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/queue"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

// Deps gom các kết nối hạ tầng mà handler cần. cmd/api tạo một lần rồi truyền vào.
type Deps struct {
	Config   config.Config
	Log      *slog.Logger
	DB       *pgxpool.Pool
	Redis    *redis.Client
	RabbitMQ *amqp.Connection
}

type Server struct {
	deps Deps
}

func New(deps Deps) *Server {
	return &Server{deps: deps}
}

// Handler trả http.Handler đã gắn đủ middleware và route.
func (s *Server) Handler() (http.Handler, error) {
	trusted, err := parsePrefixes(s.deps.Config.HTTP.TrustedProxies)
	if err != nil {
		return nil, err
	}

	r := chi.NewRouter()

	// Thứ tự middleware có ý nghĩa: realIP và RequestID phải chạy trước logger
	// để dòng log có IP và request_id; recoverer bọc mọi thứ phía sau.
	r.Use(realIP(trusted))
	r.Use(middleware.RequestID)
	r.Use(requestLogger(s.deps.Log))
	r.Use(recoverer(s.deps.Log))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.deps.Config.HTTP.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "Accept-Language"},
		AllowCredentials: true, // cần để trình duyệt gửi cookie refresh token
		MaxAge:           300,
	}))
	// Huỷ context của request quá lâu (truy vấn DB treo…) và trả 504.
	// http.Server ở cmd/api đặt WriteTimeout dài hơn mức này một chút để kịp gửi 504.
	r.Use(middleware.Timeout(s.deps.Config.HTTP.WriteTimeout))
	r.Use(sameOrigin(s.deps.Config.HTTP.CORSOrigins))

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		response.Error(w, r, s.deps.Log, apperr.NotFound("route_not_found", "Không tìm thấy đường dẫn"))
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		response.Error(w, r, s.deps.Log, apperr.Invalid("method_not_allowed", "Phương thức không được hỗ trợ"))
	})

	r.Get("/healthz", s.healthz)
	r.Get("/readyz", s.readyz)

	// Nối dây các module: repository/service/handler tạo một lần ở đây.
	q := db.New(s.deps.DB)
	clientIP := func(r *http.Request) string { return ClientIP(r.Context()) }

	categorySvc := category.NewService(q, s.deps.Redis)
	categoryH := category.NewHandler(categorySvc, s.deps.Log)

	mediaSvc := media.NewService(media.NewRepository(q), s.deps.Redis)
	mediaH := media.NewHandler(mediaSvc, s.deps.Log, clientIP)

	homeH := home.NewHandler(home.NewService(mediaSvc, s.deps.Redis), s.deps.Log)

	authCfg := s.deps.Config.Auth
	tokens := auth.NewTokenIssuer(authCfg.JWTSecret, authCfg.AccessTTL)
	// Hàng đợi gửi mail: khai báo queue (đã có thì thôi) và mở publisher
	if err := queue.DeclareJobQueue(s.deps.RabbitMQ, mail.Queue); err != nil {
		return nil, err
	}
	publisher, err := queue.NewPublisher(s.deps.RabbitMQ)
	if err != nil {
		return nil, err
	}
	authSvc, err := auth.NewService(q, s.deps.Redis, tokens, auth.NewSessions(s.deps.Redis, authCfg.RefreshTTL),
		publisher, s.deps.Config.App.PublicURL)
	if err != nil {
		return nil, err
	}
	authH := auth.NewHandler(authSvc, s.deps.Log, auth.CookieConfig{
		Domain:     authCfg.CookieDomain,
		Secure:     s.deps.Config.App.Env != "development", // dev chạy http://localhost
		AccessTTL:  authCfg.AccessTTL,
		RefreshTTL: authCfg.RefreshTTL,
	}, clientIP)
	requireAuth := auth.RequireAuth(s.deps.Log)
	newsH := news.NewHandler(news.NewService(q, s.deps.Redis), s.deps.Log)

	r.Route("/api/v1", func(r chi.Router) {
		// Mọi API đều biết ai đang gọi (nếu có đăng nhập); API nào bắt buộc đăng nhập thì thêm
		// requireAuth.
		r.Use(auth.Authenticate(tokens))

		r.Get("/ping", func(w http.ResponseWriter, _ *http.Request) {
			response.OK(w, map[string]string{"message": "pong"})
		})

		r.Get("/home", homeH.Get)

		r.Route("/auth", func(r chi.Router) {
			r.Post("/register", authH.Register)
			r.Post("/login", authH.Login)
			r.Post("/refresh", authH.Refresh)
			r.Post("/logout", authH.Logout)
			r.With(requireAuth).Get("/me", authH.Me)
			r.Post("/verify-email", authH.VerifyEmail)
			r.With(requireAuth).Post("/verify-email/resend", authH.ResendVerifyEmail)
			r.Post("/forgot-password", authH.ForgotPassword)
			r.Post("/reset-password", authH.ResetPassword)
		})

		r.Get("/categories", categoryH.List)
		r.Get("/categories/{slug}", categoryH.Get)

		r.Get("/media", mediaH.List)
		r.Get("/media/{slug}", mediaH.Get)
		r.Get("/media/{slug}/related", mediaH.Related)
		r.Post("/media/{slug}/views", mediaH.RecordView)
		r.Get("/lineup/months", mediaH.LineupMonths)

		// /news/categories khai báo trước /news/{slug}; chi luôn ưu tiên đường dẫn tĩnh, nên
		// "categories" không bao giờ bị hiểu nhầm là một slug bài viết.
		r.Get("/news/categories", newsH.Categories)
		r.Get("/news", newsH.List)
		r.Get("/news/{slug}", newsH.Get)
		r.Get("/news/{slug}/related", newsH.Related)
	})

	return r, nil
}

func parsePrefixes(list []string) ([]netip.Prefix, error) {
	out := make([]netip.Prefix, 0, len(list))
	for _, s := range list {
		p, err := netip.ParsePrefix(s)
		if err != nil {
			return nil, fmt.Errorf("HTTP_TRUSTED_PROXIES có giá trị sai %q: %w", s, err)
		}
		out = append(out, p)
	}
	return out, nil
}
```

API cũng gọi `queue.DeclareJobQueue`: API hay worker khởi động trước thì queue vẫn có sẵn.

## Kiểm tra

Đọc thư bằng API của Mailpit (`/api/v1/messages`) thay vì mở trình duyệt:

```bash
A=localhost:8080/api/v1/auth; H='-H Content-Type:application/json'; M=localhost:8025/api/v1
curl -s -X DELETE $M/messages                       # xoá hộp thư
E="thu-$(date +%s)@example.com"
curl -s -c j.txt $H -d "{\"email\":\"$E\",\"password\":\"matkhau-rat-dai\",\"display_name\":\"Thu Trang\"}" $A/register
sleep 2; curl -s $M/messages                        # 1 thư "Xác minh email tài khoản Airlife"
ID=$(curl -s $M/messages | python3 -c "import sys,json;print(json.load(sys.stdin)['messages'][0]['ID'])")
TOKEN=$(curl -s $M/message/$ID | python3 -c "import sys,json,re;print(re.search(r'token=([\w-]+)',json.load(sys.stdin)['Text']).group(1))")
curl -s -o /dev/null -w "%{http_code}\n" $H -d "{\"token\":\"$TOKEN\"}" $A/verify-email     # 204
curl -s $H -d "{\"token\":\"$TOKEN\"}" $A/verify-email                                   # 400 invalid_token (đã dùng)
curl -s -b j.txt $A/me                                                                   # "email_verified":true
```

Quên mật khẩu:

```bash
curl -s -o /dev/null -w "%{http_code}\n" $H -d "{\"email\":\"$E\"}" $A/forgot-password                # 204
curl -s -o /dev/null -w "%{http_code}\n" $H -d '{"email":"khong-ai@example.com"}' $A/forgot-password  # 204, KHÔNG có thư
# lấy token từ thư "Đặt lại mật khẩu Airlife" như trên, gọi là RT
curl -s $H -d "{\"token\":\"$RT\",\"password\":\"ngan\"}" $A/reset-password             # 400, token CHƯA bị đốt
curl -s -o /dev/null -w "%{http_code}\n" $H -d "{\"token\":\"$RT\",\"password\":\"mat-khau-moi-123\"}" $A/reset-password   # 204
curl -s -b j.txt -X POST $A/refresh                 # 401 refresh_invalid: phiên cũ đã bị thu hồi
```

Đăng nhập bằng mật khẩu cũ: 401; mật khẩu mới: 200.

```bash
rm -f j.txt
make lint && make vuln
git add . && git commit -m "Xác minh email, quên mật khẩu"
```

## Hay gặp lỗi

| Lỗi | Cách gỡ |
|---|---|
| API không khởi động: `khai báo email.send: …` | RabbitMQ chưa sẵn sàng, hoặc queue cũ khác tham số (bài 4.09) |
| Link trong thư trỏ sai địa chỉ | `APP_PUBLIC_URL` sai |
| Gõ mật khẩu ngắn rồi sửa lại thì báo link hết hạn | Kiểm tra mật khẩu sau `useToken` (token bị đốt); phải kiểm tra trước |
