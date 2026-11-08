# Cập nhật nội dung dịch vụ CARVIA

Các nhãn hiển thị về lịch trống, xe và giao nhận đã chuyển sang nội dung dịch vụ thuê xe. Mã xe nội bộ giữ nguyên để không làm hỏng quan hệ với đơn cũ; giao diện hiển thị mã CV tương ứng. Khởi động máy chủ sẽ chỉ bỏ hậu tố được sinh tự động trên tên xe; giá, trạng thái và tên đã tùy chỉnh giữ nguyên. Chính sách mới dùng phiên bản carvia-rental-v5.

Biểu mẫu liên hệ gửi POST /api/contact và chỉ báo đã tiếp nhận khi máy chủ lưu thành công. Dữ liệu nằm trong bảng contact_requests, xem tại mục Yêu cầu liên hệ trong admin.html. Có kiểm tra độ dài, email, giới hạn gửi và khóa chống gửi lặp. Biểu mẫu không tự gửi email; quản trị viên phản hồi riêng qua thông tin khách đã cung cấp.

Thông tin liên hệ lấy từ các biến môi trường trên Render:
- CARVIA_CONTACT_PHONE: số điện thoại thực tế của đơn vị.
- CARVIA_CONTACT_EMAIL: email thực tế.
- CARVIA_CONTACT_ADDRESS: địa chỉ thực tế.

Chỉ hiển thị những mục đã cấu hình. Nếu chưa có dữ liệu, trang vẫn có biểu mẫu tiếp nhận và đường dẫn quản lý chuyến đi, không tạo số điện thoại hay địa chỉ giả.

Cần xác nhận hồ sơ đội xe, địa điểm giao nhận cụ thể, phạm vi bảo hiểm và phương án lưu dữ liệu lâu dài trước khi nhận giao dịch kinh doanh thực tế. Thay câu chữ không tạo ra đội xe, bảo hiểm, cổng thanh toán hoặc hợp đồng điện tử. Các khoản thanh toán trên giao diện quản trị là ghi nhận thủ công do người vận hành xác nhận; không tự thực hiện chuyển tiền.

Các đơn cũ giữ bản chụp chính sách và lịch sử đã ghi nhận. Sau cập nhật máy chủ, tải lại trang để nhận nội dung mới.
