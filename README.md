# World Cup Predictor — Mini game dự đoán kết quả

Game dự đoán kết quả các trận World Cup theo **kèo châu Âu 3 cửa** (Thắng / Hòa / Thua).
Chạy trên localhost, dữ liệu lưu trong file JSON dễ xem và chỉnh tay.

## Cách chạy

Yêu cầu: Node.js (>= 18).

```bash
npm install      # cài 1 lần
npm start        # chạy server
```

Mở trình duyệt: **http://localhost:3000**

## Đăng nhập (ID mẫu)

ID là **mã bí mật** — đăng nhập bằng mã này, bảng xếp hạng chỉ hiện **tên**.

| Vai trò | ID mẫu | Tên hiển thị |
|---|---|---|
| Admin (cập nhật trận/kết quả) | `100000` | Admin |
| Người chơi | `a7f3k9x2` | An |
| Người chơi | `b2m8p4q1` | Bình |
| Người chơi | `c5n1r7t3` | Cường |
| Người chơi | `d9w6y2u8` | Dũng |
| Người chơi | `e4z7s3v5` | Em |

Thêm người chơi: mở `data/players.json`, thêm một dòng `{ "id": "<mã bí mật>", "name": "<tên>", "role": "player" }`.
Nên đặt ID là chuỗi ngẫu nhiên khó đoán vì nó đóng vai trò mật khẩu.

## Luật tính điểm

Mỗi trận đã có kết quả:
- **Đúng tỷ số chính xác → +3** (ưu tiên, độc lập với cửa đã chọn)
- **Đúng cửa (Thắng/Hòa/Thua) → +1**
- Sai → +0

Người chơi có thể chọn cửa A nhưng nhập tỷ số nghiêng về B — nếu trúng tỷ số vẫn được +3.
Điểm lấy mức cao nhất đạt được: đúng tỷ số thì +3, không thì xét đúng cửa +1.

## Hai bảng xếp hạng
- **Cả mùa:** cộng toàn bộ trận đã có kết quả.
- **Theo tuần:** tuần tính Thứ 2 → Chủ Nhật (giờ VN), tự động từ giờ thi đấu — không cần nhập tay.

Đồng điểm thì cùng hạng. Dữ liệu dự đoán đầy đủ nằm trong `data/predictions.json` để xuất ra phân tích sau.

## Vai trò Admin
- **Nhập kết quả trận:** chọn kết quả + tỷ số → trận chuyển "đã có kết quả", BXH cập nhật ngay.
- **Thêm/sửa cặp đấu:** nhập tay, hoặc import file JSON.
- **Import JSON:** validate định dạng → xem trước (thêm/cập nhật bao nhiêu trận) → xác nhận → **gộp theo match_id** (không nhân đôi).
- **Sao lưu:** mỗi thao tác ghi tự động backup 3 file vào `data/backups/`. Nút "Tải bản sao lưu" để export toàn bộ về máy.

## Định dạng file import (cho AI gen)

File là **một mảng** các trận:

```json
[
  {
    "match_id": "m010",
    "round": "Tứ kết",
    "team1": "Pháp",
    "team2": "Anh",
    "kickoff_time": "2026-07-05T02:00:00+07:00",
    "status": "upcoming",
    "actual_result": null,
    "actual_score": null
  }
]
```

- `match_id` (bắt buộc, duy nhất) — trùng id = cập nhật trận cũ.
- `team1`, `team2` (bắt buộc).
- `kickoff_time` (bắt buộc) — ISO 8601, nên kèm offset `+07:00`.
- `status`: `"upcoming"` hoặc `"finished"`.
- `actual_result`: `"team1"` | `"draw"` | `"team2"` | `null`.
- `actual_score`: dạng `"2-1"` hoặc `null`.

## Cấu trúc thư mục

```
worldcup-game/
├── server.js              # backend Express, API + chấm điểm
├── package.json
├── data/
│   ├── players.json       # người chơi (ID + tên)
│   ├── matches.json       # trận đấu + kết quả
│   ├── predictions.json   # dự đoán
│   └── backups/           # tự động sao lưu trước thao tác admin
└── public/
    ├── login.html
    ├── player.html        # dự đoán
    ├── admin.html         # quản trị
    ├── leaderboard.html   # xếp hạng
    └── style.css
```

## Ghi chú
- "ID bí mật" là cơ chế bảo vệ nhẹ phù hợp nhóm chơi nội bộ, không phải bảo mật cấp cao.
- **Khóa bình chọn:** trận tự khóa đúng tại thời điểm bắt đầu, tính theo **giờ server** (server quyết định, không phụ thuộc giờ máy người chơi).
- **Giờ thi đấu luôn theo giờ Việt Nam (GMT+7):**
  - File import có thể ghi giờ "trần" không offset (vd `2026-07-05T02:00:00`) — hệ thống tự hiểu là giờ VN và gắn `+07:00`.
  - Nếu muốn chỉ định múi giờ khác, ghi rõ offset trong chuỗi (vd `...+09:00`) thì hệ thống giữ nguyên.
  - Giao diện luôn hiển thị giờ VN kèm nhãn "(giờ VN)" dù máy người xem đặt ở múi giờ nào.
