import test from 'node:test';
import assert from 'node:assert/strict';
import {
  today, customers, devices, batches, batchItems, orders, events,
  resolveCustomer, queryDevices, queryBatches, queryOrders,
  getBatchSummary, getDeviceDetail, toCsv,
} from '../dist/data.mjs';

const tenantId = customers[0].id;
const otherTenant = customers[1].id;
const sn = (number) => `XMSN2026${String(number).padStart(5, '0')}`;

test('demo has two isolated tenants and exactly 25 unique SNs per tenant', () => {
  assert.equal(today, '2026-10-15');
  assert.equal(devices.length, 50);
  assert.equal(new Set(devices.map((device) => `${device.tenantId}:${device.sn}`)).size, 50);
  for (const customer of customers) {
    assert.equal(customer.appkey.length, 32);
    assert.equal(queryDevices({ tenantId: customer.id }).length, 25);
    assert.equal(queryBatches({ tenantId: customer.id }).length, 3);
  }
});

test('appkey resolution trims surrounding space and requires an exact match', () => {
  assert.equal(resolveCustomer(`  ${customers[0].appkey}\n`), customers[0]);
  assert.equal(resolveCustomer(customers[0].appkey.slice(0, 12)), null);
  assert.equal(resolveCustomer(customers[0].appkey.toUpperCase()), null);
  assert.equal(resolveCustomer(), null);
});

test('same SN can have different current states in two tenants without cross tenant results', () => {
  const left = getDeviceDetail(tenantId, sn(1));
  const right = getDeviceDetail(otherTenant, sn(1));
  assert.equal(left.device.claimStatus, 'unclaimed');
  assert.equal(right.device.claimStatus, 'claimed');
  assert.equal(left.orders.length, 0);
  assert.equal(right.orders.length, 1);
  for (const detail of [left, right]) {
    for (const rows of [detail.orders, detail.events, detail.batchItems]) {
      assert.ok(rows.every((row) => row.tenantId === detail.device.tenantId));
    }
  }
});

test('missing or unknown tenant never returns any private data', () => {
  assert.deepEqual(queryDevices(), []);
  assert.deepEqual(queryBatches(), []);
  assert.deepEqual(queryOrders(), []);
  assert.equal(getDeviceDetail(undefined, sn(1)), null);
  assert.equal(getDeviceDetail('unknown', sn(1)), null);
  assert.equal(getDeviceDetail(tenantId, 'unknown'), null);
});

test('device search accepts a single substring or a list of complete SNs', () => {
  assert.equal(queryDevices({ tenantId, query: '202600001' }).length, 1);
  assert.deepEqual(
    queryDevices({ tenantId, query: `${sn(1)}\n${sn(4)},${sn(7)}` }).map((device) => device.sn),
    [sn(1), sn(4), sn(7)],
  );
  assert.equal(queryDevices({ tenantId, query: '202600001,202600002' }).length, 0);
  assert.ok(queryDevices({ tenantId, query: '年卡' }).every((device) => device.productId === 'XM-VIP-365'));
});

test('device filters combine and date boundaries include the entire selected day', () => {
  const result = queryDevices({ tenantId, claimStatus: 'claimed', benefitStatus: 'expired', productId: 'XM-VIP-007', from: '2026-09-18', to: '2026-09-18' });
  assert.ok(result.length > 0);
  assert.ok(result.every((device) => device.createdAt.startsWith('2026-09-18') && device.benefitStatus === 'expired'));
  assert.deepEqual(queryDevices({ tenantId, from: '2026-10-16' }), []);
});

test('exact device search matches only complete SNs, including a single pasted SN', () => {
  assert.deepEqual(queryDevices({ tenantId, query: ` ${sn(1).toLowerCase()} `, exactMatch: true }).map((device) => device.sn), [sn(1)]);
  assert.deepEqual(queryDevices({ tenantId, query: '202600001', exactMatch: true }), []);
  assert.deepEqual(queryDevices({ tenantId, query: '年卡', exactMatch: true }), []);
  assert.deepEqual(queryDevices({ tenantId, query: '', exactMatch: true }), []);
  assert.deepEqual(queryDevices({ tenantId, query: `${sn(1)},${sn(4)}`, exactMatch: true }).map((device) => device.sn), [sn(1), sn(4)]);
});

test('unclaimed, claimed and restored devices preserve the one remaining claim invariant', () => {
  for (const device of devices) {
    assert.ok([0, 1].includes(device.remainingClaims));
    assert.equal(device.remainingClaims, device.claimStatus === 'claimed' ? 0 : 1);
    assert.equal(device.claimCount, orders.filter((order) => order.tenantId === device.tenantId && order.sn === device.sn).length);
    assert.equal(device.benefitStatus === 'inactive', device.claimStatus !== 'claimed');
  }
  assert.equal(getDeviceDetail(tenantId, sn(5)).device.claimCount, 2);
  assert.equal(getDeviceDetail(tenantId, sn(5)).device.remainingClaims, 0);
});

test('restore recovers eligibility and consumes quota without a monetary refund', () => {
  const detail = getDeviceDetail(tenantId, sn(4));
  assert.equal(detail.device.claimStatus, 'restored');
  assert.equal(detail.device.remainingClaims, 1);
  assert.equal(detail.device.benefitStatus, 'inactive');
  assert.equal(detail.device.startAt, null);
  assert.equal(detail.orders[0].refundStatus, 'none');
  const restore = detail.batchItems.find((item) => item.result === 'restored');
  assert.equal(restore.quotaUsed, 1);
  assert.equal(restore.beforeStatus, 'claimed');
  assert.equal(restore.afterStatus, 'restored');
});

test('actual monetary refund is represented independently of entitlement state', () => {
  const detail = getDeviceDetail(tenantId, sn(7));
  assert.equal(detail.orders[0].refundStatus, 'success');
  assert.equal(detail.device.claimStatus, 'claimed');
  assert.equal(detail.device.benefitStatus, 'active');
  assert.equal(detail.device.remainingClaims, 0);
  assert.ok(!detail.batchItems.some((item) => item.result === 'restored'));
});

test('failed restores and duplicate imports keep state and quota unchanged', () => {
  const failed = getDeviceDetail(tenantId, sn(8));
  const skipped = getDeviceDetail(tenantId, sn(6));
  assert.equal(failed.device.claimStatus, 'claimed');
  assert.equal(failed.device.remainingClaims, 0);
  assert.equal(skipped.device.claimStatus, 'unclaimed');
  for (const item of [failed.batchItems[0], skipped.batchItems[0]]) {
    assert.equal(item.beforeStatus, item.afterStatus);
    assert.equal(item.quotaUsed, 0);
  }
});

test('batch summaries reconcile per SN outcomes and stay tenant scoped', () => {
  for (const batch of batches) {
    const summary = getBatchSummary(batch.id, batch.tenantId);
    assert.equal(summary.total, summary.added + summary.skipped + summary.restored + summary.failed);
    assert.equal(summary.quotaUsed, summary.restored);
    assert.equal(summary.total, batchItems.filter((item) => item.batchId === batch.id && item.tenantId === batch.tenantId).length);
    assert.equal(getBatchSummary(batch.id, batch.tenantId === tenantId ? otherTenant : tenantId).total, 0);
    assert.ok(batchItems.filter((item) => item.batchId === batch.id && item.tenantId === batch.tenantId).every((item) =>
      devices.find((device) => device.tenantId === item.tenantId && device.sn === item.sn).productId === batch.productId,
    ));
  }
  const partial = queryBatches({ tenantId, query: '20261014' })[0];
  assert.equal(partial.status, 'partial');
  assert.deepEqual(getBatchSummary(partial.id, tenantId), { total: 11, added: 7, skipped: 1, restored: 2, failed: 1, quotaUsed: 2 });
});

test('order queries combine filters, support order IDs, and include date endpoints', () => {
  const result = queryOrders({ tenantId, status: 'success', refundStatus: 'success', from: '2026-10-09', to: '2026-10-09' });
  assert.equal(result.length, 1);
  assert.equal(result[0].sn, sn(7));
  assert.equal(queryOrders({ tenantId, query: result[0].thirdPartyOrderId })[0], result[0]);
  assert.equal(queryOrders({ tenantId, query: result[0].platformOrderId })[0], result[0]);
  assert.equal(queryOrders({ tenantId, query: 'XM-DEMO-XZ' }).length, 0);
  assert.ok(queryOrders({ tenantId, status: 'closed', refundStatus: 'none' }).length > 0);
});

test('batch search finds SN history within the selected tenant and retains batch metadata search', () => {
  const firstTenantBatches = queryBatches({ tenantId, query: sn(1) });
  const secondTenantBatches = queryBatches({ tenantId: otherTenant, query: sn(1) });
  assert.equal(firstTenantBatches.length, 1);
  assert.equal(secondTenantBatches.length, 1);
  assert.ok(firstTenantBatches[0].id.includes('LM'));
  assert.ok(secondTenantBatches[0].id.includes('XZ'));
  assert.notEqual(firstTenantBatches[0].createdAt, secondTenantBatches[0].createdAt);
  assert.equal(queryBatches({ tenantId, query: sn(4) }).length, 2);
  assert.equal(queryBatches({ tenantId, query: firstTenantBatches[0].fileName })[0].id, firstTenantBatches[0].id);
  assert.equal(queryBatches({ tenantId, query: firstTenantBatches[0].id })[0].id, firstTenantBatches[0].id);
  assert.ok(queryBatches({ tenantId, query: 'XM-VIP-007' }).every((batch) => batch.productId === 'XM-VIP-007'));
  assert.deepEqual(queryBatches({ tenantId, query: sn(4), from: '2026-10-15' }), []);
});

test('device histories include import, claim, restore, reclaim and current update time', () => {
  const detail = getDeviceDetail(tenantId, sn(5));
  assert.deepEqual([...detail.events].reverse().map((event) => event.kind), ['imported', 'claimed', 'expired', 'restored', 'claimed']);
  assert.equal(detail.events[0].title, '再次领取成功');
  for (const device of devices) {
    const related = getDeviceDetail(device.tenantId, device.sn);
    assert.equal(related.events[0].at, device.updatedAt);
    assert.ok(related.events.every((event) => event.sn === device.sn));
    assert.ok(related.batchItems.every((item) => batches.some((batch) => batch.id === item.batchId && batch.tenantId === item.tenantId)));
  }
  assert.ok(events.every((event) => event.at.slice(0, 10) <= today));
});

test('expired rights can be restored, and histories remain consistent with the 16:30 snapshot', () => {
  const restored = getDeviceDetail(tenantId, sn(4));
  const expired = restored.events.find((event) => event.kind === 'expired');
  const restore = restored.events.find((event) => event.kind === 'restored');
  assert.ok(expired.at < restore.at);
  assert.equal(restored.events[0], restore);
  assert.equal(restored.device.claimStatus, 'restored');
  assert.equal(restored.device.benefitStatus, 'inactive');
  assert.equal(restored.device.remainingClaims, 1);
  const reclaimed = getDeviceDetail(tenantId, sn(5));
  assert.ok(reclaimed.events[0].at > reclaimed.events.find((event) => event.kind === 'restored').at);
  assert.equal(reclaimed.device.benefitStatus, 'active');
  assert.ok(events.every((event) => event.at <= '2026-10-15T16:30:00+08:00'));
});

test('CSV uses UTF-8 BOM, CRLF, escaping and preserves nulls and numbers', () => {
  const csv = toCsv([{ text: '甲,"乙"\n丙', count: -3.5, empty: null }], [
    { key: 'text', label: '名称' }, { key: 'count', label: '数量' }, { key: 'empty', label: '空值' },
  ]);
  assert.equal(csv, '\uFEFF"名称","数量","空值"\r\n"甲,""乙""\n丙","-3.5",""');
  assert.equal(toCsv([], [{ key: 'sn', label: 'SN' }]), '\uFEFF"SN"');
});

test('CSV neutralizes formula injection including leading whitespace and control characters', () => {
  const values = ['=1+1', '+SUM(A1)', '-2+3', '@SUM(A1)', '  =HYPERLINK("x")', '\tCMD', '\rCMD', '\nCMD'];
  for (const value of values) {
    const csv = toCsv([{ value }], [{ key: 'value', label: '值' }]);
    assert.ok(csv.split('\r\n')[1].startsWith('"\''));
  }
  assert.equal(toCsv([{ value: 'XMSN-001' }], [{ key: 'value', label: '=danger' }]), '\uFEFF"\'=danger"\r\n"XMSN-001"');
});
