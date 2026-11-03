# Bài 11.01: Dữ liệu Ý kiến: trải nghiệm, khảo sát, góp ý

> [← Phần 10](../10-tien-ich/06-frontend-tien-ich.md) · [Mục lục](../README.md) · [Bài sau →](02-trai-nghiem.md)

## Mục tiêu

Dựng schema cho trang Ý kiến (bài chia sẻ trải nghiệm, khảo sát và phiếu bình chọn, góp ý) và nạp dữ liệu mẫu.

## Bạn sẽ học

- Dùng **khoá chính ghép** để database tự bảo đảm "một người một phiếu".
- Dùng **khoá ngoại ghép** để phương án bình chọn luôn thuộc đúng khảo sát.
- Vì sao `feedbacks.user_id` cho phép rỗng (khách vãng lai gửi được).
- Seed dữ liệu có id cố định để chạy lại không nhân đôi.

## Viết code

### Bước 1: Migration, `backend/migrations/000011_opinions.up.sql`

```sql
-- Ý kiến (Phần 11): trải nghiệm chuyến bay, khảo sát, góp ý.

-- Trải nghiệm: bài chia sẻ ngắn về một chặng bay. Chưa có ảnh (tải ảnh lên R2 làm ở Phần 12).
CREATE TABLE experiences (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    route      text NOT NULL CHECK (char_length(route) BETWEEN 3 AND 40),
    rating     smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body       text NOT NULL CHECK (char_length(body) BETWEEN 10 AND 2000),
    like_count integer NOT NULL DEFAULT 0 CHECK (like_count >= 0),
    -- deleted: người viết xoá; hidden: kiểm duyệt ẩn (Phần 12)
    status     text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'deleted')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX experiences_feed_idx ON experiences (created_at DESC, id DESC) WHERE status = 'visible';

CREATE TABLE experience_likes (
    experience_id uuid NOT NULL REFERENCES experiences (id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (experience_id, user_id)
);

-- Khảo sát: câu hỏi + các phương án. Mỗi người bình chọn MỘT lần cho mỗi khảo sát.
CREATE TABLE surveys (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question   text NOT NULL CHECK (char_length(question) BETWEEN 5 AND 200),
    -- closed: vẫn xem được kết quả nhưng không bình chọn thêm
    status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'hidden')),
    position   integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE survey_options (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id uuid NOT NULL REFERENCES surveys (id) ON DELETE CASCADE,
    label     text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
    position  integer NOT NULL,
    UNIQUE (survey_id, position),
    -- Để survey_votes tham chiếu được cặp (phương án, khảo sát)
    UNIQUE (id, survey_id)
);

CREATE TABLE survey_votes (
    survey_id  uuid NOT NULL,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    option_id  uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Khoá chính (survey_id, user_id): database tự bảo đảm một người một phiếu mỗi khảo sát,
    -- dù hai request đến cùng lúc.
    PRIMARY KEY (survey_id, user_id),
    -- Khoá ngoại ghép: phương án phải THUỘC khảo sát này, không thể gửi option của khảo sát khác.
    FOREIGN KEY (option_id, survey_id) REFERENCES survey_options (id, survey_id) ON DELETE CASCADE
);
CREATE INDEX survey_votes_option_idx ON survey_votes (option_id);

-- Góp ý: khách vãng lai gửi được (user_id rỗng), nên có Turnstile chống bot.
CREATE TABLE feedbacks (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid REFERENCES users (id) ON DELETE SET NULL,
    topic       text NOT NULL CHECK (topic IN ('content', 'shop', 'tour', 'utility', 'website', 'other')),
    rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body        text NOT NULL CHECK (char_length(body) BETWEEN 10 AND 3000),
    flight_code text CHECK (flight_code IS NULL OR char_length(flight_code) BETWEEN 3 AND 10),
    email       citext CHECK (email IS NULL OR char_length(email) <= 254),
    -- new → đã xử lý ở trang quản trị (Phần 12)
    status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done')),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedbacks_new_idx ON feedbacks (created_at DESC) WHERE status = 'new';
```

Mấy quyết định đáng nhớ:

- **`survey_votes` có khoá chính `(survey_id, user_id)`.** Hai request bình chọn đến cùng lúc: một cái thành công, cái kia vi phạm khoá
  và bị `ON CONFLICT DO NOTHING` bỏ qua. Không cần khoá bảng, không cần `SELECT` kiểm tra trước (cách đó dính race condition).
- **Khoá ngoại ghép `(option_id, survey_id) → survey_options (id, survey_id)`.** Muốn vậy `survey_options` phải có `UNIQUE (id, survey_id)`.
  Kết quả: client gửi `option_id` của khảo sát khác thì database từ chối (mã lỗi 23503), không phải code Go nhớ kiểm tra.
- **Số phiếu không lưu thành cột đếm sẵn**, mà `count(*)` từ `survey_votes` (có index theo `option_id`). Khảo sát ít phiếu nên đếm
  lúc đọc là đủ và không bao giờ lệch. `experiences.like_count` thì đếm sẵn (giống `comments`) vì bài đọc nhiều hơn thích.
- **`feedbacks.user_id` có thể NULL** và `ON DELETE SET NULL`: khách chưa đăng nhập vẫn góp ý được; xoá tài khoản thì giữ lại góp ý.
- Trải nghiệm chưa có ảnh: tải ảnh lên R2 làm ở Phần 12.

### Bước 2: Câu truy vấn, `backend/internal/db/queries/opinions.sql`

```sql
-- Dòng chảy trải nghiệm: mới nhất trước, con trỏ (created_at, id).
-- name: ListExperiences :many
SELECT e.id, e.user_id, u.display_name, u.avatar_url, e.route, e.rating, e.body, e.like_count, e.created_at
FROM experiences e
JOIN users u ON u.id = e.user_id
WHERE e.status = 'visible'
  AND (sqlc.narg('cursor_time')::timestamptz IS NULL
       OR (e.created_at, e.id) < (sqlc.narg('cursor_time')::timestamptz, sqlc.narg('cursor_id')::uuid))
ORDER BY e.created_at DESC, e.id DESC
LIMIT sqlc.arg('limit');

-- name: CreateExperience :one
INSERT INTO experiences (user_id, route, rating, body)
VALUES ($1, $2, $3, $4)
RETURNING id, created_at;

-- name: GetExperience :one
SELECT id, user_id, status FROM experiences WHERE id = $1;

-- name: SoftDeleteExperience :exec
UPDATE experiences SET status = 'deleted' WHERE id = $1;

-- name: LikeExperience :execrows
INSERT INTO experience_likes (experience_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: UnlikeExperience :execrows
DELETE FROM experience_likes WHERE experience_id = $1 AND user_id = $2;

-- name: AddExperienceLikes :one
UPDATE experiences SET like_count = GREATEST(like_count + sqlc.arg('delta')::int, 0)
WHERE id = sqlc.arg('id') RETURNING like_count;

-- name: LikedExperiences :many
SELECT experience_id FROM experience_likes
WHERE user_id = sqlc.arg('user_id') AND experience_id = ANY(sqlc.arg('ids')::uuid[]);

-- Khảo sát kèm số phiếu của từng phương án (một truy vấn, gom ở Go).
-- name: ListSurveyOptions :many
SELECT s.id AS survey_id, s.question, s.status, o.id AS option_id, o.label,
       (SELECT count(*) FROM survey_votes v WHERE v.option_id = o.id)::int AS votes
FROM surveys s
JOIN survey_options o ON o.survey_id = s.id
WHERE s.status <> 'hidden'
ORDER BY s.position, s.created_at, s.id, o.position;

-- Phiếu của một người: mỗi khảo sát họ đã chọn phương án nào.
-- name: MySurveyVotes :many
SELECT survey_id, option_id FROM survey_votes WHERE user_id = $1;

-- name: GetSurveyStatus :one
SELECT status FROM surveys WHERE id = $1;

-- Bình chọn: khoá chính (survey_id, user_id) chặn phiếu thứ hai; khoá ngoại ghép chặn phương án lạ.
-- name: CastVote :execrows
INSERT INTO survey_votes (survey_id, user_id, option_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING;

-- name: CreateFeedback :exec
INSERT INTO feedbacks (user_id, topic, rating, body, flight_code, email)
VALUES ($1, $2, $3, $4, $5, $6);

-- Dữ liệu mẫu (Phần 11): id cố định để chạy seed lại không nhân đôi.
-- name: UpsertSeedExperience :exec
INSERT INTO experiences (id, user_id, route, rating, body, like_count, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (id) DO UPDATE SET route = EXCLUDED.route, rating = EXCLUDED.rating, body = EXCLUDED.body;

-- name: UpsertSeedSurvey :exec
INSERT INTO surveys (id, question, position) VALUES ($1, $2, $3)
ON CONFLICT (id) DO UPDATE SET question = EXCLUDED.question, position = EXCLUDED.position;

-- name: UpsertSeedSurveyOption :exec
INSERT INTO survey_options (id, survey_id, label, position) VALUES ($1, $2, $3, $4)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, position = EXCLUDED.position;
```

- `ListSurveyOptions` lấy khảo sát cùng mọi phương án và số phiếu **trong một truy vấn**; Go gom lại theo khảo sát (không N+1).
- `CastVote` là `:execrows`: 0 dòng nghĩa là người này đã bình chọn khảo sát đó rồi (service trả 409 `already_voted`).

### Bước 3: Dữ liệu mẫu, `backend/cmd/seed/main.go`

Thêm hàm `seedOpinions` vào cuối file (và gọi nó sau `seedComments`), cùng struct `Experiences`, `Surveys` trong `seedData`; dữ liệu nằm ở `backend/cmd/seed/data.json`:

```go
// seedOpinions nạp trải nghiệm và khảo sát mẫu (Phần 11). Khảo sát chưa có phiếu nào: phiếu thật
// do người dùng bình chọn, không bịa số cho đẹp.
func seedOpinions(ctx context.Context, q *db.Queries, data seedData, now time.Time) error {
	for _, e := range data.Experiences {
		userID, err := q.GetUserIDByEmail(ctx, "seed-"+e.User+"@airlife.local")
		if err != nil {
			return fmt.Errorf("trải nghiệm %s: người dùng %s: %w", e.Key, e.User, err)
		}
		if err := q.UpsertSeedExperience(ctx, db.UpsertSeedExperienceParams{
			ID: uuid.NewSHA1(seedNamespace, []byte("experience:"+e.Key)), UserID: userID, Route: e.Route,
			Rating: e.Rating, Body: e.Body, LikeCount: e.Likes,
			CreatedAt: now.Add(-time.Duration(e.HoursAgo * float64(time.Hour))),
		}); err != nil {
			return fmt.Errorf("trải nghiệm %s: %w", e.Key, err)
		}
	}
	for i, sv := range data.Surveys {
		sid := uuid.NewSHA1(seedNamespace, []byte("survey:"+sv.Key))
		if err := q.UpsertSeedSurvey(ctx, db.UpsertSeedSurveyParams{ID: sid, Question: sv.Question, Position: int32(i)}); err != nil {
			return fmt.Errorf("khảo sát %s: %w", sv.Key, err)
		}
		for j, label := range sv.Options {
			if err := q.UpsertSeedSurveyOption(ctx, db.UpsertSeedSurveyOptionParams{
				ID: uuid.NewSHA1(seedNamespace, []byte(fmt.Sprintf("survey:%s:%d", sv.Key, j))), SurveyID: sid,
				Label: label, Position: int32(j),
			}); err != nil {
				return fmt.Errorf("khảo sát %s: %w", sv.Key, err)
			}
		}
	}
	return nil
}
```

Id sinh bằng `uuid.NewSHA1(seedNamespace, "experience:e1")`: cùng khoá cho cùng id, chạy `make seed` lần hai chỉ cập nhật.
Khảo sát nạp **không có phiếu nào**: phiếu thật do người dùng bình chọn, không bịa số cho đẹp (mockup ghi 4.820 lượt chỉ là chữ).

## Kiểm tra

```bash
make migrate     # 11/u opinions
make seed
```

## Hay gặp lỗi

- **`number of referenced and referencing columns for foreign key disagree`** hoặc `no unique constraint matching given keys`: thiếu `UNIQUE (id, survey_id)` trên `survey_options`.
  Khoá ngoại luôn phải trỏ tới cột có ràng buộc duy nhất.
- **`make sqlc` báo lỗi cột `email`**: `feedbacks.email` kiểu `citext` cần extension (đã bật ở migration 000001).
