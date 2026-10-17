// Nén ảnh TRƯỚC khi upload: canvas max `maxDim` px + JPEG chất lượng `quality`.
// Lái xe ở vùng sóng yếu — ảnh 12MP gốc 4–6MB gửi không nổi, bản 1200px ~200KB thì được.
// Dùng chung: chứng từ giao hàng (chuyen-detail) + chứng từ lấy hàng thu hồi.

export function resizeImage(file, maxDim = 1200, quality = 0.8) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			let { width, height } = img;
			if (width > height && width > maxDim) {
				height = Math.round((height * maxDim) / width);
				width = maxDim;
			} else if (height >= width && height > maxDim) {
				width = Math.round((width * maxDim) / height);
				height = maxDim;
			}
			const c = document.createElement("canvas");
			c.width = width;
			c.height = height;
			c.getContext("2d").drawImage(img, 0, 0, width, height);
			c.toBlob((b) => (b ? resolve(b) : reject(new Error("Nén ảnh thất bại"))), "image/jpeg", quality);
			URL.revokeObjectURL(img.src);
		};
		img.onerror = () => reject(new Error("Không đọc được ảnh"));
		img.src = URL.createObjectURL(file);
	});
}

// Ảnh thì nén; PDF / file khác gửi nguyên (phiếu xuất trả siêu thị thường là PDF).
export async function chuanBiFile(file) {
	if (!file || !/^image\//.test(file.type || "")) return file;
	try {
		const blob = await resizeImage(file, 1600, 0.82);
		const ten = (file.name || "anh").replace(/\.[^.]+$/, "") + ".jpg";
		return new File([blob], ten, { type: "image/jpeg" });
	} catch (e) {
		// HEIC trên vài máy không vẽ được lên canvas — gửi bản gốc còn hơn mất ảnh.
		return file;
	}
}
