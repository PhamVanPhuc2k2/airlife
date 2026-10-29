// Package logger tạo *slog.Logger dùng chung cho api và worker.
//
// slog có sẵn trong thư viện chuẩn của Go (từ 1.21), không cần cài thêm.
// Log có cấu trúc (key=value hoặc JSON) thay vì chuỗi tự do, để sau này lọc được
// theo request_id, user_id… trên công cụ xem log.
package logger

import (
	"log/slog"
	"os"
	"strings"
)

// New trả logger ghi ra stdout. format "json" cho production (máy đọc),
// mọi giá trị khác cho ra dạng text (người đọc khi dev).
func New(level, format string) *slog.Logger {
	opts := &slog.HandlerOptions{Level: parseLevel(level)}

	var h slog.Handler
	if strings.EqualFold(format, "json") {
		h = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		h = slog.NewTextHandler(os.Stdout, opts)
	}
	return slog.New(h)
}

func parseLevel(s string) slog.Level {
	switch strings.ToLower(s) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
