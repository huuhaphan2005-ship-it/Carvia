"use strict";
const $ = (q) => document.querySelector(q),
  $$ = (q) => [...document.querySelectorAll(q)];
const money = (n) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const read = (key, fallback = null) => {
  try {
    return JSON.parse(sessionStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key, value) => sessionStorage.setItem(key, JSON.stringify(value));
const params = new URLSearchParams(location.search),
  page = location.pathname.split("/").pop() || "index.html";
// DỮ LIỆU XE: chỉnh cars-data.js để cập nhật tên, giá, thông số, ảnh và nguồn.
const cars = CARVIA_CARS;
const priceRange = (c) => (c.price == null ? "Liên hệ báo giá" : `Từ ${money(c.price)}`);
const normalize = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase();
// BIỂU TƯỢNG VÀ ĐIỀU HƯỚNG DÙNG CHUNG
const icons = {
  car: '<path d="m5 7 2-3h10l2 3 2 3v8h-3v-2H6v2H3v-8z"/><path d="M5 9h14M6 12h2m8 0h2"/>',
  shield: /* HTML */ `
    <path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z" />
    <path d="m8 12 3 3 5-6" />
  `,
  clock: /* HTML */ `
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  `,
  wallet: /* HTML */ `
    <rect x="3" y="5" width="18" height="15" rx="3" />
    <path d="M21 10h-6v5h6M3 8V5l13-3v3" />
  `,
};
const icon = (k) => /* HTML */ `
  <span class="ico">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      ${icons[k]}
    </svg>
  </span>
`;
// Phần tài khoản (.navright, .mobile-login) được booking-flow.js cập nhật theo phiên trên máy chủ.
const navLink = (href, label) =>
  `<a href="${href}" class="${page === href ? "active" : ""}">${label}</a>`;
$("#header").innerHTML = /* HTML */ `
  <div class="wrap nav">
    <a class="brand" href="index.html" aria-label="CARVIA trang chủ">
      <img class="brand-logo" src="assets/logo-new.png" alt="Carvia" />
    </a>
    <nav class="navlinks" id="navlinks" aria-label="Điều hướng chính">
      ${navLink("index.html", "Trang chủ")} ${navLink("cars.html", "Danh sách xe")}
      ${navLink("pricing.html", "Bảng giá & ưu đãi")} ${navLink("orders.html", "Đơn thuê của tôi")}
      ${navLink("contact.html", "Liên hệ")}
      <a href="login.html" class="mobile-login">Đăng nhập</a>
    </nav>
    <div class="navright">
      <a href="login.html">Đăng nhập</a>
      <a class="btn dark small" href="register.html">Đăng ký</a>
    </div>
    <button
      class="mobile-toggle"
      aria-label="Mở menu"
      aria-expanded="false"
      aria-controls="navlinks"
    >
      ☰
    </button>
  </div>
`;
$(".mobile-toggle").onclick = (e) => {
  const open = $("#navlinks").classList.toggle("open");
  e.currentTarget.setAttribute("aria-expanded", open);
  e.currentTarget.setAttribute("aria-label", open ? "Đóng menu" : "Mở menu");
};
$("#footer").innerHTML = /* HTML */ `
  <div class="wrap">
    <div class="footer-grid">
      <div>
        <a class="brand" href="index.html">
          <img class="brand-logo" src="assets/logo-new.png" alt="Carvia" />
        </a>
        <p class="muted mt">
          Chọn chiếc xe phù hợp.
          <br />
          Bắt đầu hành trình của riêng bạn.
        </p>
      </div>
      <div>
        <h3>Khám phá CARVIA</h3>
        <div class="footer-links">
          <a href="cars.html">Danh sách xe</a>
          <a href="pricing.html">Bảng giá & khuyến mãi</a>
          <a href="process.html">Quy trình thuê xe</a>
        </div>
      </div>
      <div>
        <h3>Thông tin</h3>
        <div class="footer-links">
          <a href="orders.html">Đơn thuê của tôi</a>
          <a href="contact.html" class="${page === "contact.html" ? "active" : ""}">Liên hệ</a>
          <a href="process.html#conditions">Điều kiện thuê xe</a>
        </div>
      </div>
    </div>
    <div class="copyright">
      <span>© 2026 CARVIA · Website cho thuê ô tô tự lái</span>
    </div>
  </div>
`;
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").style.display = "block";
  setTimeout(() => ($("#toast").style.display = "none"), 2800);
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function plus(date, n) {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const dates = () => ({
  start: params.get("start") || plus(today(), 1),
  end: params.get("end") || plus(today(), 3),
});
const formatDate = (s) => new Date(s + "T12:00:00").toLocaleDateString("vi-VN");
const days = (a, b) =>
  Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
function validDates(a, b) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(a) &&
    /^\d{4}-\d{2}-\d{2}$/.test(b) &&
    a >= today() &&
    Number.isFinite(days(a, b)) &&
    days(a, b) >= 1
  );
}
// Khớp server/policy.json: hiện chỉ có điểm nhận tại TP. Hồ Chí Minh.
const locations = "<option>TP. Hồ Chí Minh</option>";
function card(c) {
  const d = dates();
  return /* HTML */ `
    <article class="car-card">
      <a
        href="detail.html?id=${c.id}&start=${esc(d.start)}&end=${esc(d.end)}"
        aria-label="Xem ${c.name}"
      >
        <div class="car-photo">
          <img
            src="assets/${c.image}"
            alt="Ảnh minh họa ${c.name}"
            style="object-position:${c.type === "Sedan" ? "50% 67%" : "50% 50%"}"
            loading="lazy"
          />
          <span class="badge">${c.type} · ${c.seats} chỗ</span>
        </div>
      </a>
      <div class="car-body">
        <span class="muted fine">${c.brand} · ${c.type}</span>
        <h3>
          <a href="detail.html?id=${c.id}&start=${esc(d.start)}&end=${esc(d.end)}">${c.name}</a>
        </h3>
        <div class="specs">
          <span>${c.gear}</span>
          <span>•</span>
          <span>${c.fuel}</span>
          <span>•</span>
          <span>${c.seats} chỗ</span>
        </div>
        <div class="car-bottom">
          <div class="price">
            ${priceRange(c)}
            <span class="per">/ ngày</span>
          </div>
          <a
            class="btn outline small"
            href="detail.html?id=${c.id}&start=${esc(d.start)}&end=${esc(d.end)}"
          >
            Xem xe
          </a>
        </div>
      </div>
    </article>
  `;
}
function pageHead(title, subtitle = "") {
  return /* HTML */ `
    <div class="wrap page-top">
      <div class="crumb">
        <a href="index.html">Trang chủ</a>
        / ${title}
      </div>
      <h1>${title}</h1>
      ${subtitle
      ? /* HTML */ `
              <p class="muted">${subtitle}</p>
            `
      : ""
    }
    </div>
  `;
}
// TRANG CHỦ: banner, tìm xe, danh sách nổi bật và giới thiệu.
function home() {
  const d = dates();
  $("#main").innerHTML = /* HTML */ `
    <div class="home-layout">
      <section class="home-hero">
        <div class="wrap">
          <div class="hero-grid">
            <div class="hero-copy">
              <div class="hero-label">CHỦ ĐỘNG LỊCH TRÌNH · TỰ DO KHÁM PHÁ</div>
              <h1>
                Chọn chiếc xe phù hợp.
                <br />
                <span>Khởi hành mọi nẻo đường.</span>
              </h1>
              <p>
                Từ chuyến đi trong phố đến kỳ nghỉ cùng gia đình. Tìm xe, xem chi phí và lên lịch
                trình của bạn cùng Carvia.
              </p>
              <div class="hero-points">
                <span>✓ Chi phí rõ ràng</span>
                <span>✓ Lựa chọn linh hoạt</span>
                <span>✓ Đặt xe thuận tiện</span>
              </div>
            </div>
            <div class="hero-showcase">
              <img
                src="assets/car-road.jpg"
                alt="Ảnh minh họa xe SUV trong thành phố"
                fetchpriority="high"
              />
              <div class="showcase-caption">
                <div>
                  <small>ƯU ĐÃI TRẢI NGHIỆM</small>
                  <strong>Giảm 10% tiền thuê xe</strong>
                </div>
                <a href="pricing.html">CARVIA10 ↗</a>
              </div>
            </div>
          </div>
          <form class="searchbar" id="hero-search">
            <div class="search-heading">
              <span>${icon("car")} Thuê xe tự lái</span>
              <small>Chọn nơi nhận xe và thời gian cho chuyến đi</small>
            </div>
            <div class="field">
              <label for="city">Địa điểm nhận xe</label>
              <select name="city" id="city">
                ${locations}
              </select>
            </div>
            <div class="field">
              <label for="start">Ngày nhận xe</label>
              <input
                type="date"
                id="start"
                name="start"
                min="${today()}"
                value="${d.start}"
                required
              />
            </div>
            <div class="field">
              <label for="end">Ngày trả xe</label>
              <input
                type="date"
                id="end"
                name="end"
                min="${plus(d.start, 1)}"
                value="${d.end}"
                required
              />
            </div>
            <button class="btn">
              Tìm xe ngay
              <span aria-hidden="true">→</span>
            </button>
          </form>
        </div>
      </section>
      <div class="wrap">
        <section class="section category-section">
          <div class="section-head">
            <div>
              <div class="eyebrow">MỖI CHUYẾN ĐI, MỘT LỰA CHỌN</div>
              <h2>Bạn muốn bắt đầu hành trình nào?</h2>
            </div>
            <p class="muted category-intro">
              Chọn xe theo nhu cầu di chuyển và tìm mức giá phù hợp với kế hoạch của bạn.
            </p>
          </div>
          <div class="category-grid">
            <a class="category-card" href="cars.html?seats=5">
              ${icon("car")}
              <h3>Xe 5 chỗ</h3>
              <p>Gọn gàng cho những chuyến đi phố.</p>
              <span>
                Xem xe
                <b>→</b>
              </span>
            </a>
            <a class="category-card" href="cars.html?seats=7">
              ${icon("car")}
              <h3>Xe 7 chỗ</h3>
              <p>Thêm không gian cho cả gia đình.</p>
              <span>
                Xem xe
                <b>→</b>
              </span>
            </a>
            <a class="category-card" href="cars.html?gear=T%E1%BB%B1+%C4%91%E1%BB%99ng">
              ${icon("clock")}
              <h3>Xe số tự động</h3>
              <p>Lựa chọn thuận tiện cho lịch trình.</p>
              <span>
                Xem xe
                <b>→</b>
              </span>
            </a>
            <a class="category-card" href="cars.html?budget=700000">
              ${icon("wallet")}
              <h3>Chi phí tiết kiệm</h3>
              <p>Khám phá xe đến 700.000đ/ngày.</p>
              <span>
                Xem xe
                <b>→</b>
              </span>
            </a>
          </div>
        </section>
      </div>
      <section class="fleet-section">
        <div class="wrap">
          <div class="section-head">
            <div>
              <div class="eyebrow">KHÁM PHÁ DANH MỤC XE</div>
              <h2>Sẵn sàng cho chuyến đi tiếp theo</h2>
            </div>
            <a class="link" href="cars.html">Xem tất cả xe →</a>
          </div>
          <div class="grid3">${cars.slice(0, 6).map(card).join("")}</div>
          <p class="demo-note">
            32 mẫu xe cùng thông tin phiên bản để bạn dễ lựa chọn. Giá hiển thị từ mức thấp nhất của
            từng mẫu xe; tổng tiền được hiển thị theo lịch thuê trước khi xác nhận.
          </p>
        </div>
      </section>
      <div class="wrap">
        <section class="section journey-section">
          <div class="center-heading">
            <div class="eyebrow">QUY TRÌNH ĐƠN GIẢN</div>
            <h2>Chuyến đi bắt đầu từ 3 bước</h2>
            <p class="muted">Từ lựa chọn xe đến xác nhận, mọi thông tin được trình bày rõ ràng.</p>
          </div>
          <div class="journey-grid">
            <article>
              <span class="step-num">01</span>
              <h3>Chọn xe & thời gian</h3>
              <p>Tìm chiếc xe phù hợp với nơi đến và lịch trình của bạn.</p>
              <a href="cars.html">Khám phá xe →</a>
            </article>
            <article>
              <span class="step-num">02</span>
              <h3>Điền thông tin</h3>
              <p>Nhập liên hệ, chọn nơi nhận và kiểm tra tổng tiền.</p>
              <span class="step-note">Thông tin dễ theo dõi</span>
            </article>
            <article>
              <span class="step-num">03</span>
              <h3>Nhận xác nhận ngay</h3>
              <p>Xe trống được giữ ngay. Mang giấy tờ và thanh toán khi nhận xe.</p>
              <a href="process.html">Xem quy trình →</a>
            </article>
          </div>
        </section>
        <section class="promo-grid">
          <div class="promo">
            <div>
              <div class="eyebrow">ƯU ĐÃI TRẢI NGHIỆM</div>
              <h2>
                Thêm một lý do
                <br />
                để lên đường.
              </h2>
              <p>Giảm 10% tiền thuê xe, tối đa 200.000đ mỗi đơn.</p>
              <a class="btn" href="pricing.html">Khám phá ưu đãi →</a>
            </div>
          </div>
          <div class="coupon-card">
            ${icon("wallet")}
            <h3>Ưu đãi cho hành trình của bạn</h3>
            <p>Nhập mã tại bước thông tin đặt xe để áp dụng mức giảm.</p>
            <a class="coupon-code" href="pricing.html">
              <strong>CARVIA10</strong>
              <span>Xem điều kiện →</span>
            </a>
            <small>Áp dụng mã tại bước đặt xe</small>
          </div>
        </section>
        <section class="benefits section">
          <div class="benefit">
            ${icon("wallet")}
            <div>
              <strong>Chi phí rõ ràng</strong>
              <span>Xem dự toán trước khi đặt xe</span>
            </div>
          </div>
          <div class="benefit">
            ${icon("clock")}
            <div>
              <strong>Thao tác thuận tiện</strong>
              <span>Tìm xe và chọn lịch trên website</span>
            </div>
          </div>
          <div class="benefit">
            ${icon("shield")}
            <div>
              <strong>Thông tin đầy đủ</strong>
              <span>Tra cứu quy trình và điều kiện thuê</span>
            </div>
          </div>
        </section>
        <section id="about" class="about section">
          <div>
            <div class="eyebrow">VỀ CARVIA</div>
            <h2>
              Mỗi hành trình mới.
              <br />
              Một lựa chọn của riêng bạn.
            </h2>
          </div>
          <div>
            <p>
              CARVIA hỗ trợ tìm kiếm, lựa chọn và đặt thuê ô tô tự lái trực tuyến.
            </p>
            <p>
              Thiết kế tập trung vào thông tin dễ tra cứu, chi phí rõ ràng và thao tác thuận tiện
              trên máy tính lẫn điện thoại.
            </p>
            <a href="contact.html" class="link">Kết nối với Carvia →</a>
          </div>
        </section>
      </div>
    </div>
  `;
  $("#start").onchange = () => {
    $("#end").min = plus($("#start").value, 1);
    if ($("#end").value < $("#end").min) $("#end").value = $("#end").min;
  };
  $("#hero-search").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (!validDates(f.get("start"), f.get("end")))
      return toast("Ngày trả phải sau ngày nhận ít nhất 1 ngày.");
    location.href = "cars.html?" + new URLSearchParams(f);
  };
}
// DANH SÁCH XE: bộ lọc và sắp xếp.
function catalog() {
  const options = (values) =>
    values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  $("#main").innerHTML =
    pageHead("Danh sách xe cho thuê", "32 mẫu xe · 5 hãng · Giá thuê từ mức thấp nhất theo ngày") +
    /* HTML */ `
      <div class="wrap catalog">
        <form class="panel filters" id="filters">
          <h3>Bộ lọc tìm kiếm</h3>
          <div class="field">
            <label for="q">Tên xe</label>
            <input id="q" name="q" placeholder="Toyota Vios, Mazda3..." />
          </div>
          <div class="field">
            <label for="brand">Hãng xe</label>
            <select id="brand" name="brand">
              <option value="">Tất cả hãng</option>
              ${options(["Toyota", "Hyundai", "Kia", "Mazda", "Honda"])}
            </select>
          </div>
          <div class="field">
            <label for="type">Loại xe</label>
            <select id="type" name="type">
              <option value="">Tất cả loại xe</option>
              ${options(["Hatchback", "Sedan", "SUV", "MPV"])}
            </select>
          </div>
          <div class="field">
            <label for="seats">Số chỗ</label>
            <select id="seats" name="seats">
              <option value="">Tất cả</option>
              <option value="5">5 chỗ</option>
              <option value="7">7 chỗ</option>
            </select>
          </div>
          <div class="field">
            <label for="gear">Hộp số</label>
            <select id="gear" name="gear">
              <option value="">Tất cả</option>
              <option value="MT">Số sàn (MT)</option>
              <option value="auto">Tự động (mọi loại)</option>
              ${options(["AT", "CVT", "IVT", "DCT"])}
            </select>
          </div>
          <div class="field">
            <label for="budget">Giá thuê từ/ngày</label>
            <select id="budget" name="budget">
              <option value="">Tất cả mức giá</option>
              <option value="700000">Đến 700.000đ</option>
              <option value="1000000">Đến 1.000.000đ</option>
              <option value="1500000">Đến 1.500.000đ</option>
              <option value="over">Từ 1.500.000đ</option>
              <option value="unknown">Liên hệ báo giá</option>
            </select>
          </div>
          <p class="demo-note">
            Lọc theo mức thấp nhất của khoảng giá. SUV gồm crossover. Mẫu có nhiều kiểu thân xe/hộp
            số có thể xuất hiện ở nhiều bộ lọc.
          </p>
          <button class="btn outline small" type="reset">Xóa bộ lọc</button>
        </form>
        <div>
          <div class="results-head">
            <span id="count" role="status"></span>
            <label>
              Sắp xếp
              <select id="sort">
                <option value="default">Theo danh sách</option>
                <option value="low">Giá thấp đến cao</option>
                <option value="high">Giá cao đến thấp</option>
              </select>
            </label>
          </div>
          <p class="notice">
            Giá niêm yết là mức thấp nhất của từng mẫu xe. Chọn xe và lịch thuê để xem đơn giá, phí
            giao nhận, ưu đãi và tổng tiền trước khi đặt. Xe chưa có giá cần liên hệ báo giá.
          </p>
          <div id="results" class="grid3"></div>
        </div>
      </div>
    `;
  for (const key of ["q", "brand", "type", "seats", "gear", "budget"]) {
    let value = params.get(key) || "";
    if (key === "gear" && value === "Tự động") value = "auto";
    $("#" + key).value = value;
  }
  const update = () => {
    const f = Object.fromEntries(new FormData($("#filters")));
    let a = cars.filter(
      (c) =>
        (!f.q || normalize(c.name).includes(normalize(f.q.trim()))) &&
        (!f.brand || c.brand === f.brand) &&
        (!f.type || c.types.includes(f.type)) &&
        (!f.seats || c.seats === Number(f.seats)) &&
        (!f.gear ||
          (f.gear === "auto" ? c.gears.some((g) => g !== "MT") : c.gears.includes(f.gear))) &&
        (!f.budget ||
          (f.budget === "unknown"
            ? c.price == null
            : c.price != null &&
            (f.budget === "over" ? c.price >= 1500000 : c.price <= Number(f.budget)))),
    );
    const sort = $("#sort").value;
    if (sort !== "default")
      a.sort((a, b) =>
        a.price == null
          ? b.price == null
            ? 0
            : 1
          : b.price == null
            ? -1
            : sort === "low"
              ? a.price - b.price
              : b.price - a.price,
      );
    $("#count").innerHTML = `Tìm thấy <strong>${a.length} / ${cars.length} mẫu xe</strong>`;
    $("#results").innerHTML = a.length
      ? a.map(card).join("")
      : `<div class="empty" style="grid-column:1/-1"><h3>Chưa có xe phù hợp</h3><p>Thử thay đổi hoặc xóa bộ lọc.</p><button id="clear-empty" class="btn outline">Xóa bộ lọc</button></div>`;
    if ($("#clear-empty")) $("#clear-empty").onclick = () => $("#filters").reset();
  };
  $("#filters").oninput = update;
  $("#filters").onchange = update;
  $("#filters").onsubmit = (e) => e.preventDefault();
  $("#filters").onreset = () => {
    $("#sort").value = "default";
    setTimeout(update, 0);
  };
  $("#sort").onchange = update;
  update();
}
// CHI TIẾT XE VÀ CHỌN NGÀY THUÊ
function detail() {
  const c = cars.find((c) => c.id === params.get("id"));
  if (!c) {
    $("#main").innerHTML =
      pageHead("Không tìm thấy xe") +
      /* HTML */ `
        <div class="wrap section"><a href="cars.html" class="btn">Quay lại danh sách xe</a></div>
      `;
    return;
  }
  const d = dates();
  if (!validDates(d.start, d.end)) {
    d.start = plus(today(), 1);
    d.end = plus(today(), 3);
  }
  $("#main").innerHTML =
    pageHead(c.name, `${c.city} · ${c.tag}`) +
    /* HTML */ `
      <div class="wrap detail-grid">
        <div>
          <img
            class="detail-img"
            src="assets/${c.image}"
            style="object-position:${c.type === "Sedan" ? "50% 67%" : "center"}"
            alt="Ảnh minh họa ${c.name}"
          />
          <p class="demo-note">
            Ảnh minh họa dòng xe, không phải ảnh chiếc xe giao thực tế. Màu sắc, đời xe và trang bị
            có thể khác.
            <a
              class="link"
              href="${esc(c.imageSourceUrl)}"
              target="_blank"
              rel="noopener noreferrer"
            >
              Nguồn ảnh ↗
            </a>
          </p>
          <div class="spec-grid">
            <div class="spec-box">
              <span>Số chỗ</span>
              ${c.seats} chỗ
            </div>
            <div class="spec-box">
              <span>Hộp số</span>
              ${c.gear}
            </div>
            <div class="spec-box">
              <span>Nhiên liệu</span>
              ${c.fuel}
            </div>
            <div class="spec-box">
              <span>Dòng xe</span>
              ${c.type}
            </div>
          </div>
          <h2>Về chiếc xe</h2>
          <p class="muted">${esc(c.description)}</p>
          <section class="vehicle-facts" aria-label="Thông tin phiên bản tham khảo">
            <div class="eyebrow">Phiên bản tham khảo</div>
            <h3>${esc(c.version)}</h3>
            <dl class="facts-list">
              <div>
                <dt>Động cơ</dt>
                <dd>${esc(c.engine)}</dd>
              </div>
              <div>
                <dt>Hộp số</dt>
                <dd>${esc(c.transmission)}</dd>
              </div>
              <div>
                <dt>Số chỗ chọn thuê</dt>
                <dd>${c.seats} chỗ</dd>
              </div>
            </dl>
            <p class="variant-note">${esc(c.versionNote)}</p>
            <a class="link" href="${esc(c.sourceUrl)}" target="_blank" rel="noopener noreferrer">
              Xem nguồn thông tin xe ↗
            </a>
            <p class="fine muted">
              Đối chiếu ngày 10/10/2026. Giá thuê từ mức thấp nhất trong danh mục, độc lập với giá
              bán xe tại nguồn.
            </p>
          </section>
          <h2>Điều kiện thuê xe</h2>
          <ul class="list">
            <li>
              Người nhận xe xuất trình căn cước hoặc hộ chiếu và giấy phép lái xe còn hiệu lực, phù
              hợp với xe thuê; thông tin phải khớp với người ký hợp đồng.
            </li>
            <li>
              Ký hợp đồng và biên bản bàn giao; cùng kiểm tra, chụp ảnh tình trạng xe, số km, nhiên
              liệu và phụ kiện trước khi nhận.
            </li>
            <li>
              Thanh toán tiền thuê và nộp tiền bảo đảm theo chi tiết đơn khi nhận xe. Tiền bảo đảm
              được đối soát và hoàn lại sau khi trả xe.
            </li>
            <li>
              Không giao xe cho người không đủ điều kiện lái xe, không cho thuê lại hoặc sử dụng xe
              trái thỏa thuận trong hợp đồng.
            </li>
            <li>
              Trả xe đúng thời gian, địa điểm và mức nhiên liệu đã nhận. Liên hệ trước nếu cần gia
              hạn hoặc có sự cố.
            </li>
            <li>
              Nhiên liệu, cầu đường, đỗ xe và chi phí vượt km, trả trễ không nằm trong tiền thuê;
              mức phí và điều kiện bảo hiểm được đối chiếu trước khi ký hợp đồng.
            </li>
          </ul>
          <a href="process.html" class="link">Xem quy trình thuê xe</a>
        </div>
        <aside class="panel book-panel" id="booking-widget"><p>Đang tải lịch xe…</p></aside>
      </div>
    `;
}
// BẢNG GIÁ THAM KHẢO
function pricing() {
  $("#main").innerHTML =
    pageHead(
      "Bảng giá & khuyến mãi",
      "Giá thuê theo ngày và các ưu đãi dành cho chuyến đi của bạn.",
    ) +
    /* HTML */ `
      <div class="wrap">
        <div class="notice mb">
          Giá hiển thị từ mức thấp nhất của từng mẫu xe cho mỗi 24 giờ. Tổng tiền theo lịch thuê,
          phí giao nhận và ưu đãi được hiển thị trước khi bạn xác nhận đặt xe.
        </div>
        <div class="table-wrap panel" style="padding:0">
          <table>
            <thead>
              <tr>
                <th>Gói xe</th>
                <th>Số chỗ</th>
                <th>Hộp số</th>
                <th>Hãng / Loại xe</th>
                <th>Giá thuê từ / ngày</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${cars
      .map(
        (c) => /* HTML */ `
                    <tr>
                      <td><strong>${c.name}</strong></td>
                      <td>${c.seats}</td>
                      <td>${c.gear}</td>
                      <td>${c.brand} / ${c.type}</td>
                      <td>${priceRange(c)}</td>
                      <td>
                        <a class="link" href="detail.html?id=${c.id}">Chọn xe</a>
                      </td>
                    </tr>
                  `,
      )
      .join("")}
            </tbody>
          </table>
        </div>
        <section class="section">
          <div class="promo">
            <div>
              <div class="eyebrow" style="color:var(--accent-soft)">Ưu đãi thuê xe</div>
              <h2>Thêm một lý do để lên đường.</h2>
              <p>Giảm 10% tiền thuê, tối đa 200.000đ mỗi đơn.</p>
            </div>
            <div class="promo-code">
              <strong>CARVIA10</strong>
              <button class="btn small mt" id="copy-code">Sao chép mã</button>
            </div>
          </div>
          <h3 class="mt">Điều kiện áp dụng</h3>
          <ul class="list">
            <li>
              Nhập mã CARVIA10 tại bước thông tin đặt xe; mức giảm được kiểm tra trên máy chủ.
            </li>
            <li>Áp dụng cho tất cả gói xe, không cộng dồn với mã khác.</li>
            <li>Mức giảm tính trên tiền thuê xe; không áp dụng cho chi phí ngoài tiền thuê.</li>
            <li>
              Máy chủ giới hạn mỗi tài khoản dùng mã trên một đơn được báo giá/đã xác nhận/hoàn tất;
              đơn hủy hoặc hết hạn giải phóng mã.
            </li>
          </ul>
        </section>
      </div>
    `;
  $("#copy-code").onclick = async () => {
    try {
      await navigator.clipboard.writeText("CARVIA10");
      toast("Đã sao chép CARVIA10");
    } catch {
      toast("Mã ưu đãi: CARVIA10");
    }
  };
}
// Quy trình và điều kiện được hiển thị từ server/policy.json trong booking-flow.js.
// TRANG LIÊN HỆ
function contact() {
  $("#main").innerHTML =
    pageHead("Liên hệ CARVIA", "Hỗ trợ đặt xe, giải đáp điều kiện thuê và tiếp nhận yêu cầu của bạn.") +
    /* HTML */ `
      <div class="wrap contact-grid section" style="padding-top:0">
        <div>
          <div class="eyebrow">Kết nối với CARVIA</div>
          <h2>
            Thông tin rõ ràng.
            <br />
            Hành trình thuận tiện.
          </h2>
          <p class="muted">Gửi yêu cầu tư vấn hoặc câu hỏi về chuyến đi qua biểu mẫu bên cạnh. Bạn cũng có thể theo dõi lịch thuê và thông tin giao nhận trong Đơn thuê của tôi.</p>
          <div id="contact-channels"></div>
        </div>
        <form id="contact-form" class="panel stack">
          <h3>Gửi yêu cầu hỗ trợ</h3>
          <div class="two">
            <div class="field">
              <label for="c-name">Họ và tên</label>
              <input id="c-name" required maxlength="80" autocomplete="name" />
            </div>
            <div class="field">
              <label for="c-email">Email</label>
              <input id="c-email" type="email" required maxlength="120" autocomplete="email" />
            </div>
          </div>
          <div class="field">
            <label for="c-message">Nội dung cần hỗ trợ</label>
            <textarea
              id="c-message"
              required
              rows="6"
              maxlength="2000"
              placeholder="Nhập câu hỏi về xe, lịch thuê hoặc đơn đặt xe của bạn..."
            ></textarea>
          </div>
          <p class="notice">
            Yêu cầu được lưu để bộ phận quản lý tiếp nhận. Vui lòng cung cấp email chính xác để nhận phản hồi; không gửi mật khẩu, số thẻ hoặc ảnh giấy tờ qua biểu mẫu.
          </p>
          <button class="btn dark" type="submit">Gửi yêu cầu</button>
          <p id="contact-result" role="status" class="fine"></p>
        </form>
      </div>
    `;
  fetch("/api/contact-info", { credentials: "same-origin" })
    .then(r => { if (!r.ok) throw Error(); return r.json(); })
    .then(info => {
      const rows = [["Hotline", info.phone], ["Email", info.email], ["Địa chỉ", info.address]].filter(([, value]) => value);
      $("#contact-channels").innerHTML = rows.length
        ? `<div class="panel"><h3>Kênh liên hệ</h3>${rows.map(([label, value]) => `<div class="row"><span>${label}</span><span>${esc(value)}</span></div>`).join("")}</div>` : "";
    }).catch(() => {});
  const form = $("#contact-form");
  let requestKey = crypto.randomUUID(), lastPayload = "";
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = form.querySelector("button");
    const result = $("#contact-result");
    const payload = { name: $("#c-name").value.trim(), email: $("#c-email").value.trim(), message: $("#c-message").value.trim() };
    const fingerprint = JSON.stringify(payload);
    if (lastPayload && lastPayload !== fingerprint) requestKey = crypto.randomUUID();
    lastPayload = fingerprint;
    button.disabled = true; result.textContent = "Đang gửi yêu cầu…";
    try {
      const response = await fetch("/api/contact", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Carvia-Request": "1" },
        body: JSON.stringify({ ...payload, request_key: requestKey })
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Không thể gửi yêu cầu. Vui lòng thử lại.");
      result.textContent = `Đã tiếp nhận yêu cầu. Mã tra cứu: ${data.id}. Vui lòng giữ mã này khi cần trao đổi về yêu cầu.`;
      form.reset(); requestKey = crypto.randomUUID(); lastPayload = "";
    } catch (error) {
      result.textContent = error.message || "Kết nối bị gián đoạn. Vui lòng thử lại.";
    } finally { button.disabled = false; }
  };
}
// ĐỊNH TUYẾN THEO TÊN TỆP HTML
const routes = {
  "index.html": home,
  "cars.html": catalog,
  "detail.html": detail,
  "booking.html": () => { },
  "success.html": () => { },
  "login.html": () => { },
  "register.html": () => { },
  "pricing.html": pricing,
  "process.html": () => { },
  "orders.html": () => { },
  "admin.html": () => { },
  "contact.html": contact,
};
(routes[page] || home)();
const titles = {
  "cars.html": "Danh sách xe",
  "detail.html": "Chi tiết xe",
  "booking.html": "Thông tin đặt xe",
  "success.html": "Xác nhận đặt xe",
  "login.html": "Đăng nhập",
  "register.html": "Đăng ký",
  "pricing.html": "Bảng giá & khuyến mãi",
  "process.html": "Quy trình thuê xe",
  "contact.html": "Liên hệ",
};
if (titles[page]) document.title = titles[page] + " | CARVIA";
if (document.modelContext?.registerTool) {
  try {
    document.modelContext.registerTool({
      name: "search_cars",
      title: "Tìm xe CARVIA",
      description: "Mở danh sách xe và lọc theo tên xe. Không tạo đơn đặt xe.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute(input) {
        if (
          !input ||
          typeof input !== "object" ||
          Object.keys(input).some((k) => k !== "query") ||
          (input.query !== undefined && typeof input.query !== "string")
        )
          throw Error("Bộ lọc không hợp lệ");
        const q = input.query?.trim() || "";
        // Cùng cách so khớp với ô "Tên xe" của danh mục (không phân biệt dấu).
        const matches = cars.filter((c) => !q || normalize(c.name).includes(normalize(q)));
        params.delete("q");
        if (q) params.set("q", q);
        history.pushState({}, "", `cars.html?${params}`);
        catalog();
        document.title = "Danh sách xe | CARVIA";
        return {
          count: matches.length,
          cars: matches.map(({ id, name, price, seats }) => ({ id, name, price, seats })),
        };
      },
    });
  } catch { }
}
