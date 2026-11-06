# Đưa CARVIA lên GitHub và tạo link demo công khai

CARVIA sử dụng HTML, CSS, JavaScript, máy chủ Python và cơ sở dữ liệu SQLite. GitHub lưu mã nguồn; dùng một Web Service để chạy cả website và API. GitHub Pages chỉ phục vụ tệp tĩnh nên không chạy được đăng ký, đăng nhập và đặt xe của dự án này.

## 1. Đưa mã nguồn lên GitHub

1. Giải nén ZIP. Mở thư mục **carvia** chứa `index.html`, `requirements.txt` và `server`.
2. Vào [GitHub New Repository](https://github.com/new). Tạo repository tên **carvia**; chọn **Public** nếu muốn mã nguồn cũng công khai. Nếu dùng lệnh bên dưới, để repository rỗng khi tạo.
3. Trong VS Code, mở Terminal tại thư mục **carvia**. Chạy lần lượt các lệnh sau, thay `TEN_GITHUB` bằng tên tài khoản:

```powershell
git init -b main
git add .
git commit -m "Add CARVIA demo"
git remote add origin https://github.com/TEN_GITHUB/carvia.git
git push -u origin main
```

Link mã nguồn có dạng `https://github.com/TEN_GITHUB/carvia`. Không tải ZIP nguyên khối lên repo: máy chủ cần các tệp đã giải nén ở thư mục gốc.

## 2. Tạo link website

1. Vào [Render Dashboard](https://dashboard.render.com/), chọn **New → Web Service**, kết nối GitHub rồi chọn repo **carvia**.
2. Chọn nhánh **main**, runtime **Python** và để trống **Root Directory**.
3. Nhập **Build Command**: `pip install -r requirements.txt`.
4. Nhập **Start Command**: `python server/app.py`.
5. Nếu cần lưu đơn lâu dài, gắn đĩa lưu trữ của dịch vụ vào `/var/data` và đặt biến môi trường `CARVIA_DATA_DIR=/var/data`. Nếu không gắn đĩa, chỉ sử dụng dữ liệu thử nghiệm vì tệp SQLite có thể mất khi dịch vụ triển khai lại hoặc khởi động lại.
6. Triển khai, đợi dịch vụ báo **Live**, sau đó sao chép URL HTTPS do Render cấp. Link thường có dạng `https://TEN_DICH_VU.onrender.com`; tên và URL thực tế do Render cấp.

Render cung cấp PORT và RENDER_EXTERNAL_URL; mã nguồn dùng các biến này để lắng nghe đúng cổng, kiểm tra tên miền và cấp cookie Secure. Nếu dùng tên miền khác, đặt CARVIA_PUBLIC_ORIGIN bằng chính URL HTTPS đó. Bản demo hỗ trợ một tên miền chính.

## 3. Kiểm tra trước khi chia sẻ

Mở URL bằng cửa sổ ẩn danh; đăng ký bằng dữ liệu thử nghiệm, đăng nhập, chọn xe và khung giờ còn trống, thử đặt và mở lại đơn. Kho dữ liệu được khởi tạo mới, không có quản trị mặc định. Nếu có terminal trên máy chủ, có thể chạy `python server/app.py --create-admin` trong đúng môi trường dữ liệu của dịch vụ để tạo quản trị.

Bản này dùng để trình diễn công khai. Không dùng thông tin khách hàng thật hoặc xử lý giao dịch thật. Không đưa tệp SQLite, biến môi trường hoặc thông tin đăng nhập vào GitHub.

Tài liệu: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages), [Render Web Services](https://render.com/docs/web-services), [Render Persistent Disks](https://render.com/docs/disks).
