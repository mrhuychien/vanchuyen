"""Su Co Hang Ve — một mã hàng trong lần hàng quay về.

BA số lượng, không phải một — và phiếu trả hàng bên ERPNext chỉ giữ số đầu:

    sl_tra       siêu thị trả bao nhiêu  -> ghi giảm công nợ
    sl_ve        thực về sân bao nhiêu   -> lệch = MẤT TRÊN ĐƯỜNG
    sl_nhap_lai  lọc ra dùng được        -> + sl_hong phải bằng sl_ve

Gộp ba số này làm một là mất đúng thông tin đáng tiền nhất: phần chênh giữa
`sl_tra` và `sl_ve` là căn cứ đòi nhà xe, và KHÔNG chứng từ kế toán nào ghi nó.

VÌ SAO BẢNG NÀY Ở `vanchuyen` CHỨ KHÔNG Ở `ketoan`: hai trong ba số lượng
(`sl_ve`, `sl_nhap_lai`) chỉ điều phối và thủ kho biết, mà họ không vào được
portal kế toán. Đặt bảng bên kia là bắt kế toán chép lại số của người khác —
và việc chép lại thì hai tuần nữa sẽ không ai chép.
"""

from frappe.model.document import Document


class SuCoHangVe(Document):
	pass
