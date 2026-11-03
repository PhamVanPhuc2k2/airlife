package payment

import (
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/auth"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/payment"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/request"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

// Webhook không dài: nội dung vài trăm byte. Giới hạn để không ai đẩy cả gigabyte vào bộ nhớ.
const maxWebhookBody = 64 << 10

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

// POST /me/bookings/{code}/pay → {"payment_url": "…"}: chuyển trình duyệt của khách tới đó.
func (h *Handler) Start(w http.ResponseWriter, r *http.Request) {
	a, _ := auth.ActorFrom(r.Context())
	url, err := h.svc.Start(r.Context(), a.UserID, chi.URLParam(r, "code"))
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, map[string]string{"payment_url": url})
}

// POST /webhooks/payment/{provider}: CỔNG gọi vào đây (không phải trình duyệt, không có cookie).
// Xác thực bằng chữ ký HMAC trong header, không bằng đăng nhập.
//
// Mã trả về quyết định cổng có gửi lại hay không:
//   - 2xx: đã nhận (kể cả sự kiện trùng): cổng dừng gửi.
//   - 400: chữ ký sai / nội dung hỏng: gửi lại cũng vô ích, và có thể là kẻ giả mạo.
//   - 5xx: lỗi của ta (database tạm hỏng): cổng gửi lại sau.
func (h *Handler) Webhook(w http.ResponseWriter, r *http.Request) {
	if chi.URLParam(r, "provider") != h.svc.Provider() {
		response.Error(w, r, h.log, apperr.NotFound("unknown_provider", "Không có cổng thanh toán này"))
		return
	}
	// Đọc NGUYÊN VĂN body: chữ ký tính trên đúng các byte cổng gửi. Giải mã rồi mã hoá lại JSON
	// có thể đổi thứ tự khoá, khoảng trắng và làm chữ ký sai.
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxWebhookBody))
	if err != nil {
		response.Error(w, r, h.log, apperr.Invalid("invalid_body", "Không đọc được nội dung"))
		return
	}
	err = h.svc.HandleWebhook(r.Context(), r.Header, body)
	switch {
	case errors.Is(err, payment.ErrBadSignature):
		h.log.WarnContext(r.Context(), "webhook thanh toán sai chữ ký", "ip", r.RemoteAddr)
		response.Error(w, r, h.log, apperr.Invalid("bad_signature", "Chữ ký không hợp lệ"))
	case errors.Is(err, payment.ErrBadPayload):
		response.Error(w, r, h.log, apperr.Invalid("bad_payload", "Nội dung không hợp lệ"))
	case err != nil:
		response.Error(w, r, h.log, err)
	default:
		response.NoContent(w)
	}
}

// --- Trang của cổng GIẢ LẬP (chỉ dev) ---------------------------------------------------------

type FakeHandler struct {
	gw  *payment.Fake
	log *slog.Logger
}

func NewFakeHandler(gw *payment.Fake, log *slog.Logger) *FakeHandler {
	return &FakeHandler{gw: gw, log: log}
}

// GET /dev/fake-gateway/{txn}: thông tin phiên để trang cổng giả lập hiện ra
func (h *FakeHandler) Session(w http.ResponseWriter, r *http.Request) {
	s, err := h.gw.Session(r.Context(), chi.URLParam(r, "txn"))
	if errors.Is(err, payment.ErrNoSession) {
		response.Error(w, r, h.log, apperr.NotFound("session_not_found", "Không có phiên thanh toán này"))
		return
	}
	if err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	response.OK(w, s)
}

// POST /dev/fake-gateway/{txn}  {"result": "succeeded" | "failed"}: khách bấm nút ở trang cổng
func (h *FakeHandler) Complete(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Result payment.Status `json:"result"`
	}
	if err := request.DecodeJSON(w, r, &in); err != nil {
		response.Error(w, r, h.log, err)
		return
	}
	returnURL, err := h.gw.Complete(r.Context(), chi.URLParam(r, "txn"), in.Result)
	if errors.Is(err, payment.ErrNoSession) {
		response.Error(w, r, h.log, apperr.NotFound("session_not_found", "Không có phiên thanh toán này"))
		return
	}
	// Webhook lỗi vẫn đưa khách về: đúng như cổng thật (trình duyệt và webhook là hai đường riêng)
	if err != nil {
		h.log.ErrorContext(r.Context(), "cổng giả lập: gọi webhook lỗi", "err", err)
	}
	response.OK(w, map[string]string{"return_url": returnURL})
}
