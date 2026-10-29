// Package sanitize lọc HTML do người dùng/biên tập viên nhập (thân bài viết, mô tả sản phẩm…).
//
// Frontend hiển thị thân bài bằng dangerouslySetInnerHTML: trình duyệt chạy MỌI thứ trong đó.
// Nếu thân bài chứa <script> hay <img src=x onerror="..."> thì mã đó chạy trên máy mọi người
// đọc bài (lỗi XSS: đánh cắp phiên đăng nhập, chèn quảng cáo…). Vì vậy lọc khi GHI vào
// database: chỉ giữ thẻ và thuộc tính an toàn, bỏ hết phần còn lại.
package sanitize

import "github.com/microcosm-cc/bluemonday"

// articlePolicy: chính sách cho nội dung bài viết, tạo một lần (policy dùng được đồng thời từ
// nhiều goroutine).
//
// UGCPolicy (User Generated Content) cho phép thẻ định dạng thường gặp: p, h2–h6, strong, em,
// ul/ol/li, blockquote, a, img, table…; bỏ script, style, iframe, form, mọi thuộc tính on*
// (onclick, onerror…) và link javascript:. Thêm:
//   - link mở tab mới có rel="noopener" (trang đích không điều khiển ngược được trang mình)
//   - link ra ngoài có rel="nofollow" (không "cho điểm SEO" link do người dùng chèn)
var articlePolicy = func() *bluemonday.Policy {
	p := bluemonday.UGCPolicy()
	p.RequireNoFollowOnLinks(true)
	p.AddTargetBlankToFullyQualifiedLinks(true)
	return p
}()

// ArticleHTML trả HTML đã lọc, an toàn để lưu và hiển thị.
func ArticleHTML(s string) string {
	return articlePolicy.Sanitize(s)
}
