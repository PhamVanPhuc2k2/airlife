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
