# CARVIA — đặt xe đơn giản

Bản đồ án chạy cục bộ với Python và SQLite, gồm 32 mẫu xe cùng hình ảnh tham khảo. Luồng mới xác nhận ngay dựa trên lịch trống trong dữ liệu demo; thanh toán khi nhận xe.

## Chạy trên Windows / VS Code

Yêu cầu Python 3.10 trở lên. Không cần cài thêm thư viện Python.

1. Giải nén ZIP, mở thư mục `carvia` trong VS Code.
2. Terminal → New Terminal. Terminal phải ở thư mục có `app.js` và thư mục `server`.
3. Tạo quản trị (chỉ cần khi chưa có tài khoản):

   ```sh
   py server/app.py --create-admin
   ```

   Nhập email và mật khẩu riêng ít nhất 12 ký tự. Khi gõ mật khẩu, Terminal không hiển thị ký tự. Không có mật khẩu mặc định.
4. Chạy website:

   ```sh
   py server/app.py
   ```

5. Mở http://localhost:8000 và giữ Terminal đang chạy. Dừng bằng Ctrl+C.

Nếu không có lệnh `py`, dùng `python` (Linux/macOS dùng `python3`). Nếu cổng đang bận: `py server/app.py --port 8001`, mở http://localhost:8001. Không dùng Live Server hoặc mở trực tiếp HTML cho luồng đặt xe.

## Quy trình mới

1. **Chọn xe và lịch:** hệ thống tự kiểm tra xe trống khi đổi ngày giờ.
2. **Thông tin và tổng tiền:** nhập liên hệ, chọn nơi nhận; xem tiền thuê và tiền bảo đảm; đồng ý điều kiện rồi bấm **Xác nhận đặt xe**. Mã ưu đãi và lời nhắn nằm trong mục không bắt buộc.
3. **Hoàn tất:** xe được xác nhận và giữ ngay nếu còn trống. Trang kết quả hiển thị thời gian, địa điểm, giấy tờ cần mang và số tiền cần chuẩn bị. Không phải đợi quản trị báo giá, chấp nhận lại hoặc ghi nhận đặt cọc.

Không trả trước trong luồng mới. Tiền thuê và tiền bảo đảm được đối chiếu khi nhận xe. Bảo đảm tách khỏi tiền thuê, hoàn lại sau khi trả xe và đối soát phát sinh. Đây là cấu hình cho đồ án; chưa tích hợp giao dịch tiền thật.

Ngày giờ theo Việt Nam, nhận sau ít nhất 2 giờ, thuê từ 24 giờ đến 90 ngày; ngày lẻ làm tròn lên. Các hạn mức km, phí phát sinh, giấy tờ, bảo hiểm và điều kiện nằm trong mục mở rộng trước khi đặt. Điều khoản hiển thị yêu cầu đối chiếu bảo hiểm theo hồ sơ của từng xe; hệ thống không tự cấp bảo hiểm.

## Giao nhận và quản trị

- Khách đăng ký ở `register.html`; xem đơn ở `orders.html`.
- Quản trị đăng nhập tài khoản tạo bằng lệnh trên, mở `admin.html`.
- **Đơn mới đã xác nhận:** không cần duyệt lại. Đến giờ nhận, quản trị ghi biên bản nhận xe: km, nhiên liệu, tình trạng; đối chiếu giấy tờ và tiền trong demo. Không cho bàn giao trước giờ nhận.
- **Khi trả:** quản trị ghi biên bản trả; hệ thống tính km vượt, giờ trễ (miễn 30 phút đầu theo `late_grace_minutes`; đơn đã xác nhận trước bản này không có ân hạn); phụ phí khác phải có lý do. Quản trị đối soát tiền bảo đảm.
- Khách có thể hủy trước giờ nhận trong mục “Cần hủy chuyến?”. Không thu trước nên đơn mới không phát sinh khoản giữ chỗ cần hoàn. Đổi lịch sau xác nhận: hủy rồi đặt lại.
- Các đơn cũ tạo trước bản này vẫn giữ quy trình báo giá/giữ chỗ cũ để không làm sai dữ liệu đang có.
- Để minh họa khách/quản trị, dùng hai trình duyệt hoặc cửa sổ ẩn danh.

## Cập nhật bản cũ

Dừng máy chủ trước khi chép đè source mới. Sao lưu thư mục `server/data` nếu đã dùng. Giữ nguyên thư mục dữ liệu này khi cập nhật; không chép đè bằng dữ liệu thử nghiệm khác. ZIP không kèm tài khoản hoặc cơ sở dữ liệu cá nhân. Khởi động lại máy chủ và tải lại trang.

## Kiểm soát nghiệp vụ

- Kiểm tra khả dụng và xác nhận cùng giao dịch SQLite, ngăn hai lượt đặt cùng chiếc xe cùng lịch; tính thời gian chuẩn bị, bảo dưỡng và xe quá hạn chưa trả.
- Giá tính ở máy chủ; tổng tiền và phiên bản chính sách phải khớp nội dung khách vừa xem. Báo giá được lưu riêng, sửa giá xe không đổi giá đơn đã đặt.
- Khóa yêu cầu chống gửi trùng; kiểm tra phiên bản khi sửa trạng thái. Mã CARVIA10 có hạn mức sử dụng theo tài khoản.
- Phân quyền khách/quản trị; mật khẩu băm PBKDF2, phiên HttpOnly/SameSite và kiểm tra CSRF.
- Dữ liệu lưu SQLite, không đưa thông tin liên hệ vào Web Storage. Trang đơn có in/lưu PDF qua trình duyệt, không phải hợp đồng ký điện tử.
- Xe DEMO là dữ liệu giả lập, giá cấu hình thấp nhất từ khoảng tham khảo; Honda Jazz chưa có giá sẽ không đặt được cho đến khi quản trị cấu hình.

## Tệp chính

- `app.js`, `cars-data.js`, `styles.css`, `theme.css`: giao diện và danh mục.
- `booking-flow.js`, `booking-flow.css`: đặt xe, tài khoản, theo dõi và quản trị.
- `server/app.py`: máy chủ và xử lý nghiệp vụ.
- `server/catalog.json`: danh mục khởi tạo; sửa dữ liệu quản trị được lưu SQLite.
- `server/policy.json`: cấu hình demo, phiên bản chính sách hiện tại `carvia-rental-v4` (đổi giá trị này mỗi khi sửa điều khoản).
- `assets/`, `SOURCES.md`: ảnh và nguồn tham khảo.
- `tests/test_booking.py`: kiểm thử API với cơ sở dữ liệu tách biệt.

## Kiểm thử

Từ thư mục `carvia`:

```sh
py -m unittest discover -s tests -v
```

Các kiểm thử gồm xác nhận ngay, lịch trùng/đặt đồng thời, chống lặp, thay đổi giá/chính sách, thanh toán khi nhận, hủy, quyền truy cập, biên bản và tương thích đơn cũ. Kiểm thử dùng thời gian mô phỏng để chạy toàn bộ giao nhận mà không phải chờ ngày thực.

Máy chủ chỉ phục vụ cục bộ. Chưa tích hợp OTP/SMS, cổng thanh toán, xác minh giấy tờ, chữ ký điện tử hoặc dịch vụ email. Chỉ dùng dữ liệu thử nghiệm và không chuyển tiền thật. Điều khoản demo chưa phải chính sách kinh doanh thực tế.

## Cập nhật giao diện và giá thuê (04/11/2026)

Cỡ chữ nội dung tăng từ 14px lên 16px; các nhãn nhỏ được điều chỉnh để dễ đọc. Ba ô số trong quy trình trang chủ cùng màu navy. Footer dùng “Website cho thuê ô tô tự lái”; trang đăng nhập/đăng ký sử dụng nội dung hướng dẫn quản lý chuyến đi.

Danh mục và bảng giá hiển thị “Từ …/ngày”, lấy trường `price` là giá thấp nhất trong khoảng giá ban đầu. Dữ liệu khởi tạo của máy chủ đã dùng trường này để tính tiền thuê. Xe chưa xác minh giá tiếp tục hiển thị “Liên hệ báo giá”, không tự gán giá. Đơn giá đã được quản trị sửa trong cơ sở dữ liệu và giá trên đơn đã xác nhận được giữ nguyên.

Bảng chi phí phân biệt tiền thuê, giao nhận, ưu đãi, tiền bảo đảm hoàn lại và tổng tiền cần chuẩn bị khi nhận xe. Điều khoản trong `server/policy.json` được đổi phiên bản để yêu cầu tải lại chi phí nếu người dùng gửi dữ liệu theo chính sách cũ; các đơn đã xác nhận vẫn lưu bản chính sách riêng.

Nội dung giao diện được biên tập theo phong cách dịch vụ tự lái. Đây vẫn là source chạy cục bộ: thay đổi câu chữ không bổ sung thanh toán trực tuyến, hợp đồng điện tử hoặc bảo hiểm tự động. Khi vận hành dịch vụ thực tế cần dùng hồ sơ xe, hợp đồng và điều kiện bảo hiểm của đơn vị cung cấp. Nội dung tham khảo nghiệp vụ: https://www.mioto.vn/privacy (đối chiếu ngày 04/11/2026); mức phí của CARVIA là cấu hình riêng, không sao chép mức phí của nhà cung cấp khác.
