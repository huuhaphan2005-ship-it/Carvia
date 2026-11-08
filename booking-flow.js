/* CARVIA: quy trình đặt xe có máy chủ. Không lưu thông tin liên hệ trong Web Storage. */
(() => {
  "use strict";
  const $ = (q) => document.querySelector(q);
  const cleanLabel = (s) => String(s ?? "").replace(/\s*·\s*xe mô phỏng\s*\d+/gi, "").replace(/Điểm nhận thử nghiệm TP\. Hồ Chí Minh/gi, "Điểm nhận xe CARVIA tại TP. Hồ Chí Minh").replace(/DEMO-(\d+)/g, "CV-$1");
  const E = (s) =>
    cleanLabel(s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const M = (n) =>
    new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
      maximumFractionDigits: 0,
    }).format(n || 0);
  const route = location.pathname.split("/").pop() || "index.html";
  const query = new URLSearchParams(location.search);
  let session = { user: null, csrf: null },
    policy,
    draftVersion = 0;
  const statuses = {
    REQUESTED: "Chờ kiểm tra xe",
    QUOTED: "Chờ chấp nhận báo giá",
    AWAITING_PAYMENT: "Chờ ghi nhận giữ chỗ",
    CONFIRMED: "Đã xác nhận",
    RENTING: "Đang thuê",
    COMPLETED: "Đã trả xe",
    CANCELLED: "Đã hủy",
    REJECTED: "Không thể đáp ứng",
    EXPIRED: "Báo giá hết hạn",
  };
  const model = (id) => CARVIA_CARS.find((c) => c.id === id);
  const dateText = (seconds) =>
    new Date(seconds * 1000).toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      dateStyle: "short",
      timeStyle: "short",
    });
  const localDate = (date) => new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 16);
  const iso = (s) => (s ? s.slice(0, 16) + ":00+07:00" : "");
  const inputDate = (s) => s?.slice(0, 16) || "";
  const trip = () => {
    try {
      return JSON.parse(sessionStorage.getItem("cv_trip") || "{}");
    } catch {
      return {};
    }
  };
  const rememberTrip = (d) => {
    const clean = {};
    for (const key of [
      "model_id",
      "vehicle_id",
      "start",
      "end",
      "delivery",
      "promo",
      "request_key",
    ])
      if (d[key] !== undefined) clean[key] = d[key];
    sessionStorage.setItem("cv_trip", JSON.stringify(clean));
  };
  const defaultDates = () => {
    const a = new Date(Date.now() + 86400000);
    a.setUTCMinutes(0, 0, 0);
    return { start: iso(localDate(a)), end: iso(localDate(new Date(a.getTime() + 2 * 86400000))) };
  };
  // Ngày YYYY-MM-DD trên URL (từ trang chủ/danh mục) → lịch hợp lệ. Giữ giờ đã lưu nếu cùng ngày;
  // mặc định 09:00 nhưng không sớm hơn thời gian báo trước, và luôn đủ thời gian thuê tối thiểu.
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  function datesFromQuery(saved = {}) {
    const qs = query.get("start"),
      qe = query.get("end");
    if (!DAY_RE.test(qs || "")) return null;
    if (saved.start?.startsWith(qs) && saved.end && (!qe || saved.end.startsWith(qe)))
      return { start: saved.start, end: saved.end };
    const hour = 3600000;
    const earliest = Math.ceil((Date.now() + policy.lead_hours * hour) / hour) * hour;
    const a = Math.max(Date.parse(qs + "T09:00:00+07:00"), earliest);
    const time = localDate(new Date(a)).slice(11, 16);
    const wanted = DAY_RE.test(qe || "") ? Date.parse(`${qe}T${time}:00+07:00`) : 0;
    const b = Math.max(wanted, a + policy.minimum_hours * hour);
    return { start: iso(localDate(new Date(a))), end: iso(localDate(new Date(b))) };
  }
  async function api(path, data) {
    const response = await fetch("/api/" + path, {
      method: data ? "POST" : "GET",
      credentials: "same-origin",
      headers: data
        ? {
            "Content-Type": "application/json",
            "X-Carvia-Request": "1",
            "X-CSRF-Token": session.csrf || "",
          }
        : {},
      body: data ? JSON.stringify(data) : undefined,
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw Error("Cần chạy website bằng máy chủ Python đi kèm. Live Server không xử lý đơn thuê.");
    }
    if (!response.ok) throw Error(result.error || "Không thể xử lý yêu cầu.");
    return result;
  }
  function notice(message, type = "error") {
    let el = $("#flow-message");
    if (!el) {
      el = document.createElement("div");
      el.id = "flow-message";
      el.className = "wrap flow-message";
      el.setAttribute("role", "alert");
      $("#main").prepend(el);
    }
    el.className = "wrap flow-message " + type;
    el.textContent = message;
    el.hidden = false;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  async function action(button, task) {
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
      await task();
    } catch (e) {
      notice(e.message);
    } finally {
      if (button) button.disabled = false;
    }
  }
  const field = (label, name, value = "", type = "text", extra = "") =>
    `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${E(value)}" ${extra}></div>`;
  const stepper = (n) =>
    `<ol class="flow-steps">${["Chọn xe & lịch", "Thông tin & tổng tiền", "Hoàn tất"].map((t, i) => `<li class="${i <= Math.min(n, 2) ? "active" : ""}" ${i === Math.min(n, 2) ? 'aria-current="step"' : ""}><b>${i + 1}</b>${t}</li>`).join("")}</ol>`;
  const banner = `<div class="flow-demo"><strong>Chủ động chuyến đi</strong><span>Xem rõ chi phí, xác nhận lịch thuê và thanh toán khi nhận xe. Theo dõi đơn thuê ngay trong tài khoản CARVIA.</span></div>`;
  function shell(title, subtitle, content, n) {
    $("#main").innerHTML =
      `<div class="wrap flow-page"><div class="flow-heading"><div class="eyebrow">CARVIA / ĐẶT XE</div><h1>${title}</h1><p class="muted">${subtitle}</p></div>${banner}${n !== undefined ? stepper(n) : ""}${content}</div>`;
    document.title = title + " | CARVIA";
  }
  function signInRequired() {
    shell(
      "Đăng nhập để tiếp tục",
      "Lịch trình đã chọn được giữ lại. Đơn thuê được gắn với tài khoản để tra cứu và xử lý.",
      `<div class="panel"><a class="btn dark" href="login.html?next=${E(route)}">Đăng nhập</a> <a class="btn outline" href="register.html?next=${E(route)}">Tạo tài khoản</a></div>`,
    );
  }
  function policyHTML(p = policy, insurance = null) {
    return `<details class="policy-box"><summary>Điều khoản thuê xe tự lái</summary>
      <dl class="facts-list">
      <div><dt>Tính ngày thuê</dt><dd>${E(p.pricing)}</dd></div>
      <div><dt>Giữ chỗ</dt><dd>${p.deposit_percent === 0 ? "Không trả trước. Thanh toán tiền thuê khi nhận xe." : `${p.deposit_percent}% tiền thuê; áp dụng cho đơn theo quy trình cũ.`}</dd></div>
      <div><dt>Tiền bảo đảm</dt><dd>${M(p.security_deposit)}; tách khỏi tiền thuê, đối soát sau khi trả xe.</dd></div>
      <div><dt>Giới hạn km</dt><dd>${p.included_km_per_day} km/ngày; vượt mức ${M(p.extra_km_rate)}/km.</dd></div>
      <div><dt>Trả trễ</dt><dd>${p.late_grace_minutes ? `Miễn phí ${p.late_grace_minutes} phút đầu; quá thời gian này tính ` : ""}${M(p.late_hour_rate)}/giờ, làm tròn lên giờ. Liên hệ trước nếu cần gia hạn; gia hạn phụ thuộc lịch xe trống.</dd></div>
      <div><dt>Giao tận nơi</dt><dd>${M(p.delivery_fee_each_way)} mỗi chiều khi chọn giao tận nơi tại TP. Hồ Chí Minh. Kiểm tra địa chỉ và thời gian giao nhận trong đơn trước khi xác nhận.</dd></div>
      <div><dt>Hủy / hoàn</dt><dd>${E(p.cancellation)} ${E(p.refund)}</dd></div>
      <div><dt>Nhiên liệu</dt><dd>${E(p.fuel)}</dd></div>
      <div><dt>Bảo hiểm</dt><dd>${E(insurance || p.insurance)}</dd></div>
      <div><dt>Giấy tờ</dt><dd>${E(p.documents)}</dd></div></dl>
      <p class="fine muted">Khi nhận xe, hai bên kiểm tra và ghi nhận tình trạng xe, km, nhiên liệu, phụ kiện cùng các thỏa thuận trong hợp đồng và biên bản bàn giao. Không cho thuê lại hoặc giao xe cho người không đủ điều kiện lái xe.</p></details>`;
  }
  function moneyBox(q, final = false) {
    const simple = q.booking_mode === "simple";
    const pickupRent = simple ? q.total : q.remaining;
    const pickupTotal = pickupRent + q.security_deposit;
    return `<section class="panel flow-money" aria-label="Chi tiết chi phí thuê xe">
      <div class="eyebrow">${final ? "CHI PHÍ ĐÃ XÁC NHẬN" : "CHI TIẾT CHI PHÍ"}</div>
      <h3>${E(q.vehicle_label)}</h3>
      <p class="fine muted">${dateText(q.start)} → ${dateText(q.end)} · Giờ Việt Nam</p>
      <div class="cost-breakdown">
        <div class="row"><span>Tiền thuê xe<small>${M(q.daily_price)} × ${q.days} ngày</small></span><strong>${M(q.base)}</strong></div>
        <div class="row"><span>Phí giao nhận hai chiều</span><strong>${q.delivery_fee ? M(q.delivery_fee) : "Miễn phí"}</strong></div>
        <div class="row cost-discount"><span>Ưu đãi${q.promo ? " · " + E(q.promo) : ""}</span><strong>${q.discount ? "−" + M(q.discount) : M(0)}</strong></div>
      </div>
      <div class="row total rental-total"><span>Tổng tiền thuê<small>Đã gồm phí giao nhận và trừ ưu đãi</small></span><strong>${M(q.total)}</strong></div>
      <div class="flow-deposit"><strong>${simple ? "Thanh toán trước: " + M(0) : "Khoản giữ chỗ: " + M(q.deposit)}</strong><p>${simple ? "Không cần trả trước. Thanh toán tiền thuê khi nhận xe." : `Tiền thuê còn lại khi nhận xe: ${M(q.remaining)}`}</p></div>
      <div class="security-cost"><div class="row"><span>Tiền bảo đảm<strong class="refundable-label">Hoàn lại sau đối soát</strong></span><strong>${M(q.security_deposit)}</strong></div><p class="fine muted">Tách riêng với tiền thuê; đối soát theo tình trạng xe và chi phí phát sinh có căn cứ khi trả xe.</p></div>
      <div class="pickup-total"><span>TỔNG TIỀN CẦN CHUẨN BỊ KHI NHẬN XE</span><strong>${M(pickupTotal)}</strong><p>Tiền thuê ${M(pickupRent)} + tiền bảo đảm ${M(q.security_deposit)}</p></div>
      <p class="cost-exclusions">Chưa gồm nhiên liệu, cầu đường, đỗ xe và chi phí phát sinh nếu vượt km, trả trễ hoặc theo biên bản đã thống nhất.</p>
      ${!simple ? `<p class="notice">${final ? "Báo giá được lưu tại thời điểm quản trị duyệt. Chỉ có hiệu lực đến hạn ghi trên đơn." : "Ước tính không giữ xe. Quản trị kiểm tra và gửi báo giá trước khi bạn chấp nhận."}</p>` : ""}
    </section>`;
  }
  function datesFields(d, prefix = "") {
    const min = localDate(new Date(Date.now() + policy.lead_hours * 3600000));
    return `<div class="two">${field("Ngày giờ nhận (GMT+7)", prefix + "start", inputDate(d.start), "datetime-local", `required min="${min}"`)}${field("Ngày giờ trả (GMT+7)", prefix + "end", inputDate(d.end), "datetime-local", "required")}</div>`;
  }
  function validateTimes(start, end) {
    const a = Date.parse(iso(start)),
      b = Date.parse(iso(end));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < Date.now() + policy.lead_hours * 3600000)
      throw Error("Chọn giờ nhận cách hiện tại ít nhất 2 giờ.");
    if (b - a < policy.minimum_hours * 3600000 || b - a > policy.maximum_days * 86400000)
      throw Error("Thời gian thuê từ 24 giờ đến 90 ngày.");
  }
  function renderVehicleOptions(vehicles, current) {
    return vehicles
      .map(
        (v) =>
          `<option value="${E(v.id)}" ${v.id === current ? "selected" : ""} ${!v.available ? "disabled" : ""}>${E(v.label)} — ${v.available ? M(v.daily_price) + "/ngày" : "Không khả dụng / chưa có giá"}</option>`,
      )
      .join("");
  }
  async function detailWidget() {
    const container = $("#booking-widget"),
      c = model(query.get("id"));
    if (!container || !c) return;
    let d = trip();
    if (d.model_id !== c.id) {
      d = { ...d, model_id: c.id, vehicle_id: "" };
    }
    // Ngày trên URL (khách vừa chọn ở trang chủ/danh mục) được ưu tiên hơn lịch đã lưu.
    d = { ...defaultDates(), ...d, ...datesFromQuery(d) };
    container.innerHTML = `<div class="eyebrow">ĐẶT XE</div><h3>Chọn lịch thuê</h3><form id="trip-form" class="stack">${datesFields(d)}
      <button type="button" class="btn outline" id="check-availability" hidden>Kiểm tra xe trống</button>
      <p id="availability-result" class="fine" role="status"></p>
      <div class="field"><label for="vehicle_id">Xe / hộp số cụ thể</label><select id="vehicle_id" name="vehicle_id" required><option value="">Kiểm tra lịch trước khi chọn</option></select></div>
      <p class="fine muted">Lịch trống được kiểm tra tự động khi bạn chọn ngày giờ.</p>
      <button class="btn dark" id="continue-booking" disabled>Tiếp tục đặt xe</button></form>${policyHTML({ ...policy, deposit_percent: 0 })}`;
    let checked = false,
      availabilitySequence = 0;
    async function check() {
      const sequence = ++availabilitySequence;
      validateTimes($("#start").value, $("#end").value);
      const params = new URLSearchParams({
        model: c.id,
        start: iso($("#start").value),
        end: iso($("#end").value),
      });
      const result = await api("vehicles?" + params);
      if (sequence !== availabilitySequence) return;
      $("#vehicle_id").innerHTML =
        `<option value="">Chọn xe</option>` + renderVehicleOptions(result.vehicles, d.vehicle_id);
      const first = result.vehicles.find((v) => v.available);
      if (!$("#vehicle_id").value && first) $("#vehicle_id").value = first.id;
      $("#availability-result").textContent = first
        ? "Có xe còn trống trong thời gian bạn chọn."
        : "Chưa có xe trống hoặc chưa cấu hình giá. Thử lịch khác.";
      checked = !!first;
      $("#continue-booking").disabled = !checked;
    }
    $("#check-availability").onclick = (e) => action(e.currentTarget, check);
    for (const id of ["start", "end"])
      $("#" + id).onchange = () => {
        checked = false;
        $("#continue-booking").disabled = true;
        $("#availability-result").textContent = "Đang kiểm tra lịch trống…";
        check().catch((error) => {
          $("#availability-result").textContent = error.message;
        });
      };
    $("#trip-form").onsubmit = (e) => {
      e.preventDefault();
      action($("#continue-booking"), async () => {
        if (!checked) throw Error("Kiểm tra xe trống trước khi tiếp tục.");
        rememberTrip({
          ...d,
          vehicle_id: $("#vehicle_id").value,
          start: iso($("#start").value),
          end: iso($("#end").value),
          request_key: d.request_key || crypto.randomUUID(),
        });
        location.href = "booking.html";
      });
    };
    try {
      await check();
    } catch (e) {
      $("#availability-result").textContent = e.message;
    }
  }
  async function loadDraft() {
    const result = await api("draft");
    draftVersion = result.version;
    return {
      ...defaultDates(),
      name: session.user.name,
      email: session.user.email,
      ...result.draft,
      ...trip(),
    };
  }
  async function saveDraft(d) {
    const result = await api("draft", { version: draftVersion, draft: d });
    draftVersion = result.version;
    rememberTrip(d);
  }
  async function checkout() {
    if (!session.user) {
      signInRequired();
      return;
    }
    const d = await loadDraft();
    // Một khóa cố định cho cả lượt đặt: gửi lại sau lỗi mạng không tạo đơn thứ hai.
    d.request_key ||= crypto.randomUUID();
    if (!d.vehicle_id) {
      shell("Chọn xe trước khi gửi yêu cầu", "", `<a class="btn dark" href="cars.html">Tìm xe</a>`);
      return;
    }
    const all = await api("vehicles");
    shell(
      "Hoàn tất đặt xe",
      "Kiểm tra lịch, nhập liên hệ và xem tổng tiền. Xe trống được xác nhận ngay sau khi đặt.",
      `
      <div class="flow-grid"><form id="customer-request" class="panel stack">
      <h2>Chuyến đi của bạn</h2>${datesFields(d)}
      <div class="field"><label for="vehicle_id">Xe đã chọn</label><select id="vehicle_id" name="vehicle_id" required>${renderVehicleOptions(all.vehicles, d.vehicle_id)}</select></div>
      <div class="field"><label for="delivery">Nhận và trả xe</label><select name="delivery" id="delivery"><option value="station">Tại điểm nhận xe CARVIA tại TP. Hồ Chí Minh</option><option value="address">Giao và nhận xe tại địa chỉ của bạn ở TP. Hồ Chí Minh</option></select></div>
      ${field("Địa chỉ giao nhận", "address", d.address, "text", 'maxlength="250"')}
      <h2>Thông tin liên hệ</h2>${field("Họ và tên", "name", d.name, "text", 'required minlength="2" maxlength="80" autocomplete="name"')}
      <div class="two">${field("Số di động Việt Nam", "phone", d.phone, "tel", 'required maxlength="18" autocomplete="tel"')}${field("Email", "email", d.email, "email", 'required maxlength="120" autocomplete="email"')}</div>
      <p class="fine muted">Dùng số điện thoại của người trực tiếp nhận xe.</p>
      <details><summary>Mã ưu đãi hoặc lời nhắn (không bắt buộc)</summary>${field("Mã ưu đãi (không bắt buộc)", "promo", d.promo, "text", 'maxlength="30" placeholder="CARVIA10"')}
      <div class="field"><label for="note">Ghi chú</label><textarea id="note" name="note" maxlength="500" rows="3">${E(d.note)}</textarea></div></details>
      <p class="fine">Khi nhận xe: mang giấy tờ định danh và GPLX phù hợp; cùng kiểm tra xe và thanh toán.</p>${policyHTML({ ...policy, deposit_percent: 0 })}<label class="check"><input id="request-agree" type="checkbox" required><span>Tôi đã kiểm tra lịch, tổng tiền và đồng ý với điều khoản thuê xe.</span></label>
      <div class="actions"><button id="save-draft" type="button" class="btn outline">Lưu bản nháp</button><button type="submit" class="btn dark">Xác nhận đặt xe</button></div>
      </form><aside><div class="panel"><div class="eyebrow">TRƯỚC KHI GỬI</div><h3>Đặt xong, nhận xác nhận ngay</h3><p>Không cần chờ gửi và chấp nhận báo giá. Thanh toán khi nhận xe.</p><button id="preview-price" class="btn outline">Xem lại ước tính</button></div><div id="live-estimate"></div></aside></div>`,
      1,
    );
    $("#delivery").value = d.delivery || "station";
    const quoteElement = $("#live-estimate"),
      quoteAside = quoteElement.parentElement;
    function placeQuote() {
      if (!quoteElement.isConnected) return;
      if (window.innerWidth <= 1000) $("#request-agree").closest("label").before(quoteElement);
      else quoteAside.append(quoteElement);
    }
    placeQuote();
    window.addEventListener("resize", placeQuote);
    const toggle = () => {
      $("#address").required = $("#delivery").value === "address";
      $("#address").parentElement.hidden = !$("#address").required;
    };
    toggle();
    $("#delivery").onchange = toggle;
    function formData() {
      const f = Object.fromEntries(new FormData($("#customer-request")));
      const v = all.vehicles.find((v) => v.id === f.vehicle_id);
      return {
        ...d,
        ...f,
        start: iso(f.start),
        end: iso(f.end),
        model_id: v?.model_id,
        booking_mode: "simple",
      };
    }
    // latestQuote: báo giá khớp dữ liệu form hiện tại. shownQuote: báo giá khách đang nhìn thấy.
    let latestQuote = null,
      shownQuote = null,
      pending = null,
      priceSequence = 0;
    function preview() {
      const sequence = ++priceSequence;
      latestQuote = null;
      const run = api("estimate", formData()).then(
        (q) => {
          if (sequence !== priceSequence) return;
          latestQuote = shownQuote = q;
          $("#live-estimate").innerHTML = moneyBox(q);
        },
        (error) => {
          if (sequence !== priceSequence) return;
          shownQuote = null;
          $("#live-estimate").innerHTML = `<p class="notice">${E(error.message)}</p>`;
          throw error;
        },
      );
      pending = run.catch(() => {});
      return run;
    }
    $("#customer-request").addEventListener("change", (e) => {
      if (["start", "end", "vehicle_id", "delivery", "address", "promo"].includes(e.target.name))
        preview().catch(() => {});
    });
    $("#preview-price").onclick = (e) => action(e.currentTarget, preview);
    $("#save-draft").onclick = (e) =>
      action(e.currentTarget, async () => {
        await saveDraft(formData());
        notice("Đã lưu bản nháp trên máy chủ.", "ok");
      });
    $("#customer-request").onsubmit = (e) => {
      e.preventDefault();
      action(e.submitter, async () => {
        const seen = shownQuote; // tổng tiền trên màn hình lúc khách bấm
        const data = formData();
        const p = data.phone.replace(/[ ()-]/g, "").replace(/^\+84/, "0");
        if (!/^0[35789]\d{8}$/.test(p)) throw Error("Nhập số di động Việt Nam hợp lệ, gồm 10 số.");
        if (data.name.trim().length < 2) throw Error("Họ tên cần ít nhất 2 ký tự.");
        data.phone = p;
        // Rời ô địa chỉ/mã ưu đãi sẽ tính lại giá: chờ kết quả thay vì bắt bấm lại.
        await pending;
        if (!latestQuote) await preview();
        if (!latestQuote) throw Error("Chưa tính được tổng tiền. Vui lòng thử lại.");
        // Chỉ dừng lại khi tổng tiền thực sự khác con số khách vừa xem.
        if (!seen || seen.total !== latestQuote.total)
          throw Error(
            `Tổng tiền đã cập nhật thành ${M(latestQuote.total)}. Kiểm tra lại rồi bấm xác nhận đặt xe.`,
          );
        const order = await api("orders", {
          ...data,
          agree: $("#request-agree").checked,
          expected_total: latestQuote.total,
          policy_version: latestQuote.policy.version,
        });
        sessionStorage.removeItem("cv_trip");
        location.href = "success.html?id=" + encodeURIComponent(order.id);
      });
    };
    await preview().catch(() => {});
  }
  function shortId(id) {
    return id.slice(0, 15) + "…";
  }
  function orderCard(o, admin = false) {
    const c = model(o.quote?.model_id || modelIdFromOrder(o));
    return `<article class="panel order-card"><div class="order-top"><span class="status status-${o.status}">${E(o.status_label)}</span><span class="fine muted">${dateText(o.created)}</span></div>
    <h3>${E(o.quote?.vehicle_label || c?.name || o.vehicle_id)}</h3><p class="fine">${dateText(o.start)} → ${dateText(o.end)}</p><p class="fine muted">Mã ${E(shortId(o.id))}</p>
    <div class="row"><strong>${o.quote ? M(o.quote.total) : "Chưa có báo giá"}</strong><a class="btn outline small" href="success.html?id=${E(o.id)}${admin ? "&admin=1" : ""}">Xem chi tiết</a></div>
    ${o.refund_due ? `<p class="notice">Chờ hoàn giữ chỗ: ${M(o.refund_due)}</p>` : ""}</article>`;
  }
  let vehiclesCache = [];
  function modelIdFromOrder(o) {
    return vehiclesCache.find((v) => v.id === o.vehicle_id)?.model_id;
  }
  async function ordersPage() {
    if (!session.user) {
      signInRequired();
      return;
    }
    vehiclesCache = (await api("vehicles")).vehicles;
    const result = await api("orders");
    shell(
      "Đơn thuê của tôi",
      "Theo dõi báo giá, xác nhận, giao nhận và đối soát trong cùng một nơi.",
      `
      <div class="actions"><a class="btn dark" href="cars.html">Tạo yêu cầu mới</a><button class="btn outline" id="refresh-orders">Cập nhật trạng thái</button></div>
      <div class="order-list">${result.orders.length ? result.orders.map((o) => orderCard(o)).join("") : '<div class="panel"><h3>Chưa có yêu cầu thuê</h3><p>Chọn xe và lịch trình để bắt đầu.</p></div>'}</div>`,
    );
    $("#refresh-orders").onclick = () => ordersPage().catch((e) => notice(e.message));
  }
  function actionForm(action, title, body, button = title) {
    return `<form class="panel stack order-action" data-action="${action}"><h3>${title}</h3>${body}<button class="btn dark">${button}</button></form>`;
  }
  const reasonField = () =>
    field("Lý do", "reason", "", "text", 'required minlength="3" maxlength="500"');
  const demoCheck = () =>
    '<label class="check"><input type="checkbox" name="demo_confirm" required><span>Tôi xác nhận đã đối chiếu khoản tiền thực nhận hoặc thực hoàn với chứng từ.</span></label>';
  function reportForm(action, q) {
    return actionForm(
      action,
      action === "handover" ? "Biên bản nhận xe" : "Biên bản trả xe",
      `
    <div class="two">${field("Số km đồng hồ", "odometer", "", "number", 'required min="0" max="3000000" step="1"')}${field("Nhiên liệu (%)", "fuel", "", "number", 'required min="0" max="100" step="1"')}</div>
    <div class="field"><label for="condition">Tình trạng xe / phụ kiện / hư hỏng</label><textarea name="condition" id="condition" required minlength="5" maxlength="2000"></textarea></div>
    ${
      action === "handover"
        ? `<label class="check"><input type="checkbox" name="documents_checked" required><span>Đã đối chiếu người nhận, giấy tờ định danh và GPLX.</span></label><label class="check"><input type="checkbox" name="money_checked" required><span>Đã đối chiếu khoản tiền thuê còn lại ${M(q.remaining)} và tiền bảo đảm ${M(q.security_deposit)}.</span></label>`
        : `${field("Phụ phí khác đã thống nhất (đ)", "other_fee", 0, "number", 'required min="0" max="100000000" step="1"')}${field("Lý do phụ phí / chứng từ đối chiếu", "fee_reason", "", "text", 'maxlength="1000"')}<p class="fine muted">Hệ thống tính km vượt và giờ trả trễ theo báo giá đã chốt; tiền bảo đảm được đối soát ở bước riêng.</p>`
    }
    <label class="check"><input type="checkbox" name="acknowledged" required><span>Hai bên đã đối chiếu nội dung. Đây không phải chữ ký điện tử thực.</span></label>`,
    );
  }
  function reportsHTML(reports) {
    return Object.entries(reports)
      .map(
        ([
          kind,
          r,
        ]) => `<section class="panel"><h3>${kind === "handover" ? "Biên bản nhận xe" : "Biên bản trả xe"}</h3><p>${dateText(r.at)}</p><div class="row"><span>Đồng hồ km</span><strong>${r.odometer}</strong></div><div class="row"><span>Nhiên liệu</span><strong>${r.fuel}%</strong></div><p class="readonly">${E(r.condition)}</p>
    ${kind === "return" ? `<div class="row"><span>Km vượt</span><strong>${r.extra_km} km</strong></div><div class="row"><span>Giờ trả trễ</span><strong>${r.late_hours} giờ</strong></div><div class="row"><span>Tổng phát sinh</span><strong>${M(r.extra_total)}</strong></div><p class="fine">${E(r.fee_reason || "Không có phụ phí khác.")}</p><div class="row"><span>Tiền bảo đảm cần hoàn</span><strong>${M(r.security_refund_due)}</strong></div><div class="row"><span>Cần thanh toán bổ sung</span><strong>${M(r.additional_due)}</strong></div><p class="notice">${r.settled ? "Đã đối soát." : "Chờ quản trị đối soát tiền bảo đảm / phụ phí."}</p>` : ""}</section>`,
      )
      .join("");
  }
  async function orderPage() {
    if (!session.user) {
      signInRequired();
      return;
    }
    const id = query.get("id");
    if (!id) {
      location.replace("orders.html");
      return;
    }
    const o = await api("orders/" + encodeURIComponent(id));
    vehiclesCache = (await api("vehicles")).vehicles;
    const v = vehiclesCache.find((v) => v.id === o.vehicle_id),
      q = o.quote;
    const admin = session.user.role === "admin";
    const simple = q?.booking_mode === "simple";
    let forms = "";
    if (admin && ["REQUESTED", "EXPIRED"].includes(o.status))
      forms += actionForm(
        "quote",
        "Kiểm tra và lập báo giá",
        `
      <p>Xe ${E(o.vehicle_id)} · ${E(v?.label)}. Máy chủ kiểm tra lại lịch và giá ngay khi lập báo giá.</p><label class="check"><input type="checkbox" name="contact_checked" required><span>Đã kiểm tra thông tin liên hệ / địa chỉ. Không phải xác minh OTP tự động.</span></label>
      <div class="field"><label for="insurance">Phạm vi bảo hiểm / mức tự chịu / loại trừ</label><textarea name="insurance" id="insurance" required minlength="15" maxlength="1000" placeholder="Ghi phạm vi bảo hiểm, mức miễn thường và trường hợp loại trừ theo hồ sơ xe."></textarea></div>`,
        "Gửi báo giá và giữ xe 30 phút",
      );
    if (!admin && o.status === "QUOTED")
      forms += actionForm(
        "accept",
        "Chấp nhận báo giá",
        `<label class="check"><input name="agree" type="checkbox" required><span>Tôi đồng ý báo giá ${M(q.total)} và điều khoản ${E(q.policy.version)}, bao gồm điều kiện bảo hiểm được ghi trong báo giá.</span></label>`,
        "Đồng ý báo giá",
      );
    if (admin && o.status === "AWAITING_PAYMENT")
      forms += actionForm(
        "record_demo_payment",
        "Đối soát khoản giữ chỗ",
        `${field("Số tiền giữ chỗ (đ)", "amount", q.deposit, "number", 'required min="1" step="1"')}${demoCheck()}`,
        "Ghi nhận thanh toán và xác nhận xe",
      );
    if (["REQUESTED", "QUOTED", "AWAITING_PAYMENT", "CONFIRMED"].includes(o.status))
      forms += actionForm(
        "cancel",
        "Hủy yêu cầu",
        `${reasonField()}<p class="fine">${simple ? "Bạn chưa thanh toán trước nên không có khoản giữ chỗ cần hoàn." : "Khoản giữ chỗ đã ghi nhận được chuyển sang chờ hoàn theo điều kiện thuê xe."}</p>`,
        "Xác nhận hủy",
      );
    if (admin && ["REQUESTED", "QUOTED", "AWAITING_PAYMENT"].includes(o.status))
      forms += actionForm("reject", "Không thể đáp ứng", reasonField(), "Từ chối có lý do");
    if (admin && o.refund_due > 0)
      forms += actionForm(
        "refund",
        "Hoàn khoản giữ chỗ",
        `<p>Số tiền cần hoàn: <strong>${M(o.refund_due)}</strong></p>${demoCheck()}`,
        "Ghi nhận đã hoàn tiền",
      );
    if (admin && o.status === "CONFIRMED") forms += reportForm("handover", q);
    if (admin && o.status === "RENTING") forms += reportForm("return", q);
    if (admin && o.status === "COMPLETED" && !o.reports.return?.settled)
      forms += actionForm(
        "settle",
        "Đối soát cuối cùng",
        `<p>Hoàn tiền bảo đảm: ${M(o.reports.return?.security_refund_due)} · Thu bổ sung: ${M(o.reports.return?.additional_due)}</p>${demoCheck()}`,
        "Hoàn tất đối soát",
      );
    let revise = "";
    if (!admin && ["REQUESTED", "QUOTED", "AWAITING_PAYMENT", "EXPIRED"].includes(o.status))
      revise = `<details class="panel no-print"><summary>Sửa xe / lịch trình / giao nhận</summary><form class="stack order-action" data-action="revise">${datesFields(o.payload, "r-")}
      <div class="field"><label for="r-vehicle">Xe cụ thể</label><select name="vehicle_id" id="r-vehicle">${renderVehicleOptions(vehiclesCache, o.vehicle_id)}</select></div>
      <div class="field"><label for="r-delivery">Giao nhận</label><select name="delivery" id="r-delivery"><option value="station">Tại điểm nhận xe CARVIA</option><option value="address">Giao cùng địa chỉ (TP. Hồ Chí Minh)</option></select></div>
      ${field("Địa chỉ giao nhận", "r-address", o.payload.address, "text", 'maxlength="250"')}${field("Mã ưu đãi", "r-promo", o.payload.promo, "text", 'maxlength="30"')}
      <p class="notice">Sửa yêu cầu hủy báo giá và giữ chỗ cũ. Thông tin người thuê được giữ nguyên; cần quản trị gửi báo giá mới.</p><button class="btn outline">Lưu thay đổi và yêu cầu báo giá lại</button></form></details>`;
    shell(
      simple && o.status === "CONFIRMED"
        ? "Đặt xe thành công"
        : o.status === "REQUESTED"
          ? "Đã tiếp nhận yêu cầu"
          : "Chi tiết đơn thuê",
      o.status === "REQUESTED"
        ? "Yêu cầu đã được lưu và đang chờ kiểm tra. Xe chưa được giữ cho đến khi xác nhận lịch thuê."
        : simple
          ? o.status === "CONFIRMED"
            ? "Xe đã được giữ theo lịch của bạn. Không cần chờ xác nhận thêm, thanh toán khi nhận xe."
            : "Theo dõi thông tin và trạng thái chuyến đi tại đây."
          : "Báo giá và lịch sử xử lý được lưu trên máy chủ.",
      `
      ${simple ? `<section class="panel pickup-next"><h2>${o.status === "CONFIRMED" ? "Bạn cần làm gì tiếp theo?" : "Thông tin chuyến đi"}</h2><p><strong>Nhận xe:</strong> ${dateText(o.start)} · ${o.payload.delivery === "address" ? E(o.payload.address) : E(policy.locations[0].name)}</p><p><strong>Trả xe:</strong> ${dateText(o.end)} · cùng địa điểm nhận.</p>${o.status === "CONFIRMED" ? `<p><strong>Mang theo:</strong> giấy tờ định danh và GPLX phù hợp.</p><p><strong>Chuẩn bị:</strong> ${M(q.total + q.security_deposit)} gồm ${M(q.total)} tiền thuê và ${M(q.security_deposit)} tiền bảo đảm hoàn lại sau đối soát.</p><p class="fine muted">Khi gặp nhân viên, cùng kiểm tra xe rồi thanh toán và nhận xe. Bạn chưa thanh toán trực tuyến.</p>` : ""}</section>` : ""}
      <div class="order-top"><span class="status status-${o.status}">${E(o.status_label)}</span><span class="fine order-id">${E(o.id)}</span></div>
      <div class="actions no-print"><a href="${admin ? "admin.html" : "orders.html"}" class="btn outline">${admin ? "Về quản trị" : "Đơn thuê của tôi"}</a><button class="btn outline" id="refresh-order">Cập nhật trạng thái</button>${q ? '<button class="btn outline" id="print-order">In / lưu PDF đơn và điều khoản</button>' : ""}</div>
      ${o.expires && ["QUOTED", "AWAITING_PAYMENT"].includes(o.status) ? `<div class="flow-hold">Báo giá / giữ xe đến <strong>${dateText(o.expires)}</strong>. <span id="hold-countdown" data-until="${o.expires}"></span></div>` : ""}
      ${o.status === "AWAITING_PAYMENT" ? '<p class="notice">Đã đồng ý báo giá. Chờ đối chiếu khoản giữ chỗ trước khi xác nhận xe.</p>' : ""}
      <div class="flow-grid"><div class="stack"><section class="panel"><h2>${E(q?.vehicle_label || v?.label || o.vehicle_id)}</h2><dl class="facts-list"><div><dt>Lịch trình</dt><dd>${dateText(o.start)} → ${dateText(o.end)}</dd></div><div><dt>Hộp số</dt><dd>${E(q?.gear || v?.gear)}</dd></div><div><dt>Người thuê</dt><dd>${E(o.payload.name)}</dd></div><div><dt>Liên hệ</dt><dd>${E(o.payload.phone)}<br>${E(o.payload.email)}</dd></div><div><dt>Giao nhận</dt><dd>${o.payload.delivery === "address" ? E(o.payload.address) : E(policy.locations[0].name)}</dd></div><div><dt>Ghi chú</dt><dd>${E(o.payload.note || "Không có")}</dd></div></dl>
      ${simple ? "" : `<p class="fine muted">Thông tin liên hệ ${q?.contact_checked_demo ? "đã được nhân viên kiểm tra" : "chưa được quản trị kiểm tra"}. Chưa tích hợp OTP/SMS.</p>`}</section>
      ${revise}<div class="no-print stack">${simple && !admin && forms ? `<details class="panel"><summary>Cần hủy chuyến?</summary>${forms}</details>` : forms}</div>${reportsHTML(o.reports)}
      <details class="panel"><summary>Lịch sử xử lý</summary><ol class="order-history">${o.history.map((h) => `<li><time>${dateText(h.at)}</time><strong>${E(h.actor)}</strong><p>${E(h.message)}</p></li>`).join("")}</ol></details></div>
      <aside class="stack">${q ? moneyBox(q, true) : '<div class="panel"><h3>Chưa có báo giá xác nhận</h3><p>Quản trị kiểm tra chiếc xe, địa chỉ giao nhận và điều kiện thuê trước khi báo giá. Giá ở danh mục chỉ để tham khảo.</p></div>'}
      ${simple ? "" : `<div class="panel"><h3>Đối soát khoản giữ chỗ</h3><div class="row"><span>Đã ghi nhận</span><strong>${M(o.paid)}</strong></div><div class="row"><span>Chờ hoàn</span><strong>${M(o.refund_due)}</strong></div><div class="row"><span>Đã hoàn</span><strong>${M(o.refunded)}</strong></div></div>`}
      ${policyHTML(q?.policy || policy, q?.insurance)}</aside></div>`,
      2,
    );
    if ($("#r-delivery")) $("#r-delivery").value = o.payload.delivery || "station";
    $("#refresh-order").onclick = (e) => action(e.currentTarget, orderPage);
    if ($("#print-order"))
      $("#print-order").onclick = () => {
        document.querySelectorAll("details.policy-box").forEach((x) => (x.open = true));
        window.print();
      };
    const timer = $("#hold-countdown");
    if (timer) {
      const tick = () => {
        if (!timer.isConnected) {
          clearInterval(interval);
          return;
        }
        const left = Math.max(0, Math.floor(o.expires - Date.now() / 1000));
        timer.textContent = left
          ? `Còn ${Math.floor(left / 60)} phút ${left % 60} giây.`
          : "Đã hết hạn. Cập nhật trạng thái để yêu cầu báo giá mới.";
      };
      const interval = setInterval(tick, 1000);
      tick();
    }
    document.querySelectorAll(".order-action").forEach(
      (form) =>
        (form.onsubmit = (e) => {
          e.preventDefault();
          action(e.submitter, async () => {
            const data = Object.fromEntries(new FormData(form));
            data.action = form.dataset.action;
            data.version = o.version;
            for (const input of form.querySelectorAll("input[type=checkbox]"))
              data[input.name] = input.checked;
            for (const input of form.querySelectorAll("input[type=number]"))
              data[input.name] = Number(input.value);
            if (data.action === "revise") {
              data.start = iso(data["r-start"]);
              data.end = iso(data["r-end"]);
              data.address = data["r-address"];
              data.promo = data["r-promo"];
            }
            await api("orders/" + o.id, data);
            await orderPage();
          });
        }),
    );
  }
  async function adminPage() {
    if (!session.user) {
      signInRequired();
      return;
    }
    if (session.user.role !== "admin") throw Error("Tài khoản này không có quyền quản trị.");
    const result = await api("admin");
    vehiclesCache = result.vehicles;
    const counts = {};
    result.orders.forEach((o) => (counts[o.status] = (counts[o.status] || 0) + 1));
    shell(
      "Quản trị đặt xe",
      "Quản lý đơn thuê, lịch xe, giao nhận và đối soát.",
      `
      <div class="admin-counts">${["REQUESTED", "QUOTED", "AWAITING_PAYMENT", "CONFIRMED", "RENTING"].map((s) => `<div class="panel"><strong>${counts[s] || 0}</strong><span>${statuses[s]}</span></div>`).join("")}</div>
      <section class="panel"><h2>Yêu cầu liên hệ</h2><p class="fine">Hiển thị 100 yêu cầu gần nhất. Phản hồi khách qua thông tin đã cung cấp.</p><div class="stack">${(result.contacts || []).map(c => `<article><strong>${E(c.name)}</strong><p>${E(c.email)} · ${dateText(c.created)}</p><p class="readonly">${E(c.message)}</p></article>`).join("") || "<p>Chưa có yêu cầu liên hệ.</p>"}</div></section><div class="actions"><button class="btn outline" id="refresh-admin">Cập nhật</button><a class="btn outline" href="#fleet">Quản lý xe / bảo dưỡng</a></div>
      <div class="field"><label for="status-filter">Lọc trạng thái</label><select id="status-filter"><option value="">Tất cả</option>${Object.entries(
        statuses,
      )
        .map(([k, v]) => `<option value="${k}">${v}</option>`)
        .join("")}</select></div><div id="admin-orders" class="order-list"></div>
      <section id="fleet" class="section"><h2>Xe và đơn giá thuê</h2><p>Giá cập nhật áp dụng cho báo giá mới. Không thay đổi báo giá đã chốt. Tắt xe ngăn nhận lịch mới; cần xử lý riêng các đơn đã xác nhận.</p>
      <div class="fleet-list">${result.vehicles.map((v) => `<form class="panel vehicle-form" data-id="${E(v.id)}"><div><strong>${E(v.id)}</strong><span class="fine muted"> · ${E(v.gear)}</span></div><label>Tên phiên bản / chiếc xe<input name="label" required minlength="5" maxlength="180" value="${E(v.label)}"></label><label>Đơn giá thuê/ngày (đ)<input type="number" name="daily_price" value="${v.daily_price ?? ""}" min="100000" max="20000000" step="1000" placeholder="Để trống nếu chưa có giá"></label><label class="check"><input name="active" type="checkbox" ${v.active ? "checked" : ""}><span>Cho phép nhận yêu cầu</span></label><button class="btn outline small">Lưu xe</button></form>`).join("")}</div></section>
      <section class="section"><h2>Khóa lịch bảo dưỡng</h2><form id="block-form" class="panel stack"><div class="field"><label for="block-vehicle">Xe</label><select id="block-vehicle" name="vehicle_id">${result.vehicles.map((v) => `<option value="${v.id}">${E(v.label)}</option>`).join("")}</select></div>${datesFields(defaultDates(), "b-")}${field("Lý do khóa lịch", "reason", "", "text", 'required minlength="3" maxlength="250"')}<button class="btn dark">Thêm lịch bảo dưỡng</button></form>
      <div class="stack">${result.blocks.map((b) => `<div class="panel row"><div><strong>${E(b.vehicle_id)} · ${E(b.reason)}</strong><p>${dateText(b.start)} → ${dateText(b.end)}</p></div><button class="btn outline small unblock" data-id="${E(b.id)}">Bỏ khóa</button></div>`).join("")}</div></section>`,
    );
    const render = () => {
      $("#admin-orders").innerHTML =
        result.orders
          .filter((o) => !$("#status-filter").value || o.status === $("#status-filter").value)
          .map((o) => orderCard(o, true))
          .join("") || "<p>Không có đơn phù hợp.</p>";
    };
    render();
    $("#status-filter").onchange = render;
    $("#refresh-admin").onclick = (e) => action(e.currentTarget, adminPage);
    document.querySelectorAll(".vehicle-form").forEach(
      (form) =>
        (form.onsubmit = (e) => {
          e.preventDefault();
          action(e.submitter, async () => {
            const f = Object.fromEntries(new FormData(form));
            await api("admin/vehicle", {
              id: form.dataset.id,
              label: f.label,
              daily_price: f.daily_price === "" ? null : Number(f.daily_price),
              active: form.elements.active.checked,
            });
            notice("Đã lưu xe. Báo giá cũ được giữ nguyên.", "ok");
          });
        }),
    );
    $("#block-form").onsubmit = (e) => {
      e.preventDefault();
      action(e.submitter, async () => {
        const d = Object.fromEntries(new FormData(e.target));
        await api("admin/block", {
          vehicle_id: d.vehicle_id,
          start: iso(d["b-start"]),
          end: iso(d["b-end"]),
          reason: d.reason,
        });
        await adminPage();
      });
    };
    document.querySelectorAll(".unblock").forEach(
      (button) =>
        (button.onclick = () =>
          action(button, async () => {
            await api("admin/unblock", { id: button.dataset.id });
            await adminPage();
          })),
    );
  }
  async function authPage() {
    const register = route === "register.html";
    const destinations = ["booking.html", "orders.html", "admin.html"];
    const next = destinations.includes(query.get("next")) ? query.get("next") : "orders.html";
    shell(
      register ? "Tạo tài khoản" : "Đăng nhập",
      "Quản lý lịch thuê, theo dõi đơn đặt xe và chuẩn bị cho chuyến đi của bạn.",
      `<form id="server-auth" class="panel stack auth-server">${register ? field("Họ và tên", "auth-name", "", "text", 'required minlength="2" maxlength="80" autocomplete="name"') : ""}${field("Email", "auth-email", "", "email", 'required maxlength="120" autocomplete="email"')}${field("Mật khẩu", "auth-password", "", "password", `required minlength="10" maxlength="200" autocomplete="${register ? "new-password" : "current-password"}"`)}<button class="btn dark">${register ? "Đăng ký" : "Đăng nhập"}</button><a class="link" href="${register ? "login" : "register"}.html?next=${next}">${register ? "Đã có tài khoản? Đăng nhập" : "Chưa có tài khoản? Đăng ký"}</a><p class="fine muted">Sử dụng email bạn thường dùng để quản lý đơn thuê. Không chia sẻ mật khẩu hoặc thông tin đăng nhập với người khác.</p></form>`,
    );
    $("#server-auth").onsubmit = (e) => {
      e.preventDefault();
      action(e.submitter, async () => {
        await api(register ? "register" : "login", {
          name: $("#auth-name")?.value,
          email: $("#auth-email").value,
          password: $("#auth-password").value,
        });
        location.href = next;
      });
    };
  }
  function processPage() {
    shell(
      "Thuê xe trong 3 bước",
      "Xem giá trước, xác nhận ngay và thanh toán khi nhận xe.",
      `<div class="process-grid">${[
        [
          "01",
          "Chọn xe & lịch thuê",
          "Chọn xe, ngày giờ nhận và trả. Hệ thống kiểm tra lịch trống.",
        ],
        [
          "02",
          "Thông tin & tổng tiền",
          "Điền liên hệ, chọn nơi nhận và xem tiền thuê cùng tiền bảo đảm. Bấm xác nhận đặt xe.",
        ],
        [
          "03",
          "Nhận xác nhận & nhận xe",
          "Xe trống được giữ ngay. Đến đúng lịch, mang giấy tờ định danh và GPLX; cùng kiểm tra xe, thanh toán rồi nhận xe.",
        ],
      ]
        .map(
          ([n, title, body]) =>
            `<article class="panel"><div class="eyebrow">BƯỚC ${n}</div><h3>${title}</h3><p>${body}</p></article>`,
        )
        .join("")}</div>
      <section class="panel"><h2>Khi trả xe</h2><p>Trả xe đúng giờ và cùng mức nhiên liệu. Nhân viên kiểm tra xe cùng bạn, đối soát phát sinh nếu có và hoàn tiền bảo đảm sau đối soát. Không cần duyệt lại yêu cầu trên website.</p></section>
      <section id="conditions">${policyHTML({ ...policy, deposit_percent: 0 })}</section><a href="cars.html" class="btn dark">Chọn xe</a>`,
    );
  }
  async function header() {
    const nav = $(".navright");
    if (!nav) return;
    nav.innerHTML = session.user
      ? `<a class="account-name" href="orders.html">${E(session.user.name)}</a>${session.user.role === "admin" ? '<a class="btn outline small" href="admin.html">Quản trị</a>' : ""}<button class="btn dark small" id="server-logout">Đăng xuất</button>`
      : '<a href="login.html">Đăng nhập</a><a class="btn dark small" href="register.html">Đăng ký</a>';
    if ($("#server-logout"))
      $("#server-logout").onclick = (e) =>
        action(e.currentTarget, async () => {
          await api("logout", {});
          sessionStorage.removeItem("cv_trip");
          location.href = "index.html";
        });
    const mobile = $(".mobile-login");
    if (mobile && session.user) mobile.remove();
    if (session.user?.role === "admin") {
      const a = document.createElement("a");
      a.href = "admin.html";
      a.textContent = "Quản trị";
      a.className = "mobile-login";
      $("#navlinks").append(a);
    }
  }
  async function catalogAvailability() {
    if (route !== "cars.html") return;
    const host = document.createElement("section");
    host.className = "wrap availability-panel";
    const saved = trip();
    // Ngày từ trang chủ (URL) hoặc lịch đã lưu; liên kết "Xem xe" mang theo lịch này.
    let dates = datesFromQuery(saved) || (saved.start && saved.end ? { start: saved.start, end: saved.end } : null);
    host.innerHTML = `<form id="catalog-dates" class="panel"><h3>Tìm xe theo lịch thuê</h3>${datesFields({ ...defaultDates(), ...dates }, "c-")}<div class="actions"><button class="btn dark">Kiểm tra lịch</button><button type="button" class="btn outline" id="clear-availability">Bỏ lọc lịch</button><span id="calendar-count" role="status" class="fine"></span></div></form>`;
    const main = $("#main");
    main.insertBefore(host, main.children[1] || null);
    let availableModels = null;
    function mark() {
      const cards = [...document.querySelectorAll(".car-card")];
      for (const card of cards) {
        const link = card.querySelector('a[href*="detail.html"]');
        if (!link) continue;
        const id = new URL(link.href).searchParams.get("id");
        card.hidden = availableModels ? !availableModels.has(id) : false;
        if (dates)
          card.querySelectorAll('a[href*="detail.html"]').forEach((a) => {
            const u = new URL(a.href);
            u.searchParams.set("start", dates.start.slice(0, 10));
            u.searchParams.set("end", dates.end.slice(0, 10));
            a.href = u.href;
          });
      }
      $("#calendar-count").textContent = availableModels
        ? `${cards.filter((c) => !c.hidden).length} mẫu xe đáp ứng bộ lọc và lịch thuê.`
        : "";
    }
    new MutationObserver(mark).observe($("#results"), { childList: true });
    mark();
    $("#catalog-dates").onsubmit = (e) => {
      e.preventDefault();
      action(e.submitter, async () => {
        validateTimes($("#c-start").value, $("#c-end").value);
        dates = { start: iso($("#c-start").value), end: iso($("#c-end").value) };
        const r = await api("vehicles?" + new URLSearchParams(dates));
        availableModels = new Set(r.vehicles.filter((v) => v.available).map((v) => v.model_id));
        rememberTrip({ ...trip(), ...dates });
        mark();
      });
    };
    for (const key of ["c-start", "c-end"])
      $("#" + key).onchange = () => {
        availableModels = null;
        mark();
        $("#calendar-count").textContent = "Lịch vừa thay đổi. Bấm kiểm tra lịch để cập nhật.";
      };
    $("#clear-availability").onclick = () => {
      availableModels = null;
      dates = null;
      mark();
    };
  }
  async function init() {
    try {
      [session, policy] = await Promise.all([api("session"), api("policy")]);
      await header();
      if (route === "detail.html") await detailWidget();
      else if (route === "booking.html") await checkout();
      else if (route === "success.html") await orderPage();
      else if (route === "orders.html") await ordersPage();
      else if (route === "admin.html") await adminPage();
      else if (["login.html", "register.html"].includes(route)) await authPage();
      else if (route === "process.html") processPage();
      else if (route === "cars.html") await catalogAvailability();
    } catch (e) {
      if (!$("#main").textContent.trim())
        shell(
          "Không thể tải quy trình đặt xe",
          "",
          `<div class="panel"><p>${E(e.message)}</p><p>Chạy <code>python server/app.py</code> trong thư mục carvia rồi mở <strong>http://localhost:8000</strong>.</p><a class="btn outline" href="cars.html">Danh mục xe</a></div>`,
        );
      else notice(e.message);
      if ($("#booking-widget"))
        $("#booking-widget").innerHTML =
          '<p>Cần máy chủ để kiểm tra lịch và gửi yêu cầu.</p><p class="fine">Chạy <code>python server/app.py</code>, sau đó mở localhost:8000.</p>';
    }
  }
  init();
})();
