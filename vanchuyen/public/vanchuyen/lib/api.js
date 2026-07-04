// Wrap frappe.call (đã có sẵn trên www page) + upload file có CSRF.

function csrf() {
	return (window.VC_CONTEXT && window.VC_CONTEXT.csrfToken) || window.frappe?.csrf_token || "";
}

/** Gọi whitelisted method, resolve = message. reject = đối tượng lỗi (đã có exc). */
export function call(method, args = {}) {
	return new Promise((resolve, reject) => {
		if (!window.frappe || !window.frappe.call) {
			reject({ message: "frappe.call chưa sẵn sàng" });
			return;
		}
		window.frappe.call({
			method,
			args,
			callback: (r) => resolve(r ? r.message : undefined),
			error: (r) => reject(r),
		});
	});
}

/** Upload multipart (ảnh chứng từ). fields = object các tham số kèm theo. */
export async function upload(method, file, fields = {}) {
	const fd = new FormData();
	fd.append("file", file, file.name || "chungtu.jpg");
	for (const [k, v] of Object.entries(fields)) fd.append(k, v);
	const res = await fetch("/api/method/" + method, {
		method: "POST",
		headers: { "X-Frappe-CSRF-Token": csrf() },
		body: fd,
	});
	let data = {};
	try {
		data = await res.json();
	} catch (e) {
		/* ignore */
	}
	if (!res.ok) throw data;
	return data.message;
}

/** Trích message lỗi tiếng Việt gọn nhất từ response frappe (bỏ HTML/traceback). */
export function errText(err) {
	try {
		if (!err) return "Có lỗi xảy ra";
		if (typeof err === "string") return err;
		const msgs = err._server_messages ? JSON.parse(err._server_messages) : null;
		if (msgs && msgs.length) {
			const m = JSON.parse(msgs[0]);
			return String(m.message || m).replace(/<[^>]+>/g, "");
		}
		if (err.message) return String(err.message).replace(/<[^>]+>/g, "");
		return "Có lỗi xảy ra";
	} catch (e) {
		return "Có lỗi xảy ra";
	}
}
