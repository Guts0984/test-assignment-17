export const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Channel stub</title>
<style>
body{font:14px system-ui,sans-serif;margin:16px;max-width:1100px}
label{display:inline-block;margin:0 8px 6px 0}input{padding:4px}button{padding:6px 10px;margin:2px}
table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #ccc;padding:2px 6px;text-align:right}
pre{background:#f4f4f4;padding:8px;max-height:200px;overflow:auto}
</style></head><body>
<h1>Sales channel stub</h1>
<div>
<label>hotelId <input id="hotelId" size="36"></label>
<label>roomTypeId <input id="roomTypeId" size="36"></label><br>
<label>check-in <input id="checkIn" type="date"></label>
<label>check-out <input id="checkOut" type="date"></label>
<label>N <input id="count" type="number" value="10" min="1" max="500" style="width:70px"></label>
</div>
<button id="one">send one booking</button><button id="many">send N bookings</button>
<button id="modify">modify last</button><button id="cancel">cancel last</button>
<pre id="log">ready</pre>
<h2>Current availability (version per room type)</h2>
<div id="state"></div>
<script>
const $ = (id) => document.getElementById(id);
const form = () => ({ hotelId: $('hotelId').value.trim(), roomTypeId: $('roomTypeId').value.trim(), checkIn: $('checkIn').value, checkOut: $('checkOut').value });
const send = async (extra) => {
  const res = await fetch('/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...form(), ...extra }) });
  const body = await res.json();
  $('log').textContent = JSON.stringify(body, null, 1).slice(0, 4000);
};
$('one').onclick = () => send({ type: 'new', count: 1 });
$('many').onclick = () => send({ type: 'new', count: Number($('count').value) });
$('modify').onclick = () => send({ type: 'modify', count: 1 });
$('cancel').onclick = () => send({ type: 'cancel', count: 1 });
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const render = (s) => {
  $('state').innerHTML = '<p>accepted ' + s.stats.accepted + ', ignored ' + s.stats.ignored + ', rejected ' + s.stats.rejected + ', failed on purpose ' + s.stats.failedOnPurpose + '</p>' +
    s.roomTypes.map((r) => {
      if (!$('roomTypeId').value) { $('roomTypeId').value = r.roomTypeId; $('hotelId').value = r.hotelId; }
      return '<h3>room type ' + esc(r.roomTypeId) + ' &middot; version ' + r.version + ' &middot; ' + esc(r.receivedAt) + '</h3><table><tr><th>night</th>' +
        r.nights.slice(0, 30).map((n) => '<th>' + esc(n.night.slice(5)) + '</th>').join('') + '</tr><tr><th>free</th>' +
        r.nights.slice(0, 30).map((n) => '<td>' + n.available + (n.stopSell ? ' X' : '') + '</td>').join('') + '</tr><tr><th>price</th>' +
        r.nights.slice(0, 30).map((n) => '<td>' + (n.price === null ? '-' : n.price) + '</td>').join('') + '</tr></table>';
    }).join('');
};
const poll = async () => { try { render(await (await fetch('/state')).json()); } catch (e) { /* retry on next tick */ } };
const live = new EventSource('/events'); live.onmessage = poll; poll();
</script></body></html>`;
