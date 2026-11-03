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
