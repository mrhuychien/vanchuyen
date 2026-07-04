// Hash router hỗ trợ :param và ?query.

export function parseHash() {
	let h = location.hash.replace(/^#/, "") || "/";
	const [path, qs] = h.split("?");
	const query = {};
	if (qs) {
		new URLSearchParams(qs).forEach((v, k) => {
			query[k] = v;
		});
	}
	return { path: path || "/", query };
}

export function matchRoute(routes, path) {
	const pp = path.split("/").filter(Boolean);
	for (const r of routes) {
		const rp = r.path.split("/").filter(Boolean);
		if (rp.length !== pp.length) continue;
		const params = {};
		let ok = true;
		for (let i = 0; i < rp.length; i++) {
			if (rp[i].startsWith(":")) params[rp[i].slice(1)] = decodeURIComponent(pp[i]);
			else if (rp[i] !== pp[i]) {
				ok = false;
				break;
			}
		}
		if (ok) return { route: r, params };
	}
	return null;
}

export function go(hash) {
	location.hash = hash.replace(/^#/, "");
}

export function replace(hash) {
	history.replaceState(null, "", "#" + hash.replace(/^#/, ""));
}
