export const today = '2026-10-15';

export const customers = [
  {
    id: 'tenant-luming',
    name: '鹿鸣智能',
    initials: '鹿鸣',
    color: '#F36545',
    appkey: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  },
  {
    id: 'tenant-xingzhou',
    name: '星舟科技',
    initials: '星舟',
    color: '#7566D9',
    appkey: 'b2c3d4e5f60718293a4b5c6d7e8f901a',
  },
];

const productDefinitions = [
  {
    productId: 'XM-VIP-365',
    productName: '智能音箱 · 年度会员',
    benefitName: '喜马拉雅 VIP 年卡',
    duration: 365,
    amount: 198,
  },
  {
    productId: 'XM-VIP-007',
    productName: '体验设备 · 7 日会员',
    benefitName: '喜马拉雅 VIP 7 日体验',
    duration: 7,
    amount: 9.9,
  },
];

const stamp = (date, time = '09:30:00') => `${date}T${time}+08:00`;
const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const pad = (value, length = 3) => String(value).padStart(length, '0');
const batchId = (tenantIndex, batchNumber) => `IMP-2026${['0918', '1008', '1014'][batchNumber - 1]}-${tenantIndex === 0 ? 'LM' : 'XZ'}${pad(batchNumber)}`;

export const batches = customers.flatMap((customer, tenantIndex) =>
  [1, 2, 3].map((number) => ({
    id: batchId(tenantIndex, number),
    tenantId: customer.id,
    fileName: `${customer.name}_SN清单_${['20260918', '20261008', '20261014'][number - 1]}.csv`,
    createdAt: stamp(['2026-09-18', '2026-10-08', '2026-10-14'][number - 1]),
    status: number === 3 ? 'partial' : 'completed',
    productId: number === 2 ? 'XM-VIP-365' : 'XM-VIP-007',
  })),
);

const makeScenarios = (tenantIndex) => {
  const scenarios = [
    { imported: '2026-10-14', batch: 3, actions: [] },
    { imported: '2026-10-08', batch: 2, actions: [{ kind: 'claimed', date: '2026-10-13' }] },
    { imported: '2026-09-18', batch: 1, actions: [{ kind: 'claimed', date: '2026-09-20' }] },
    { imported: '2026-09-18', batch: 1, actions: [{ kind: 'claimed', date: '2026-09-20' }, { kind: 'restored', date: '2026-10-14', batch: 3 }] },
    { imported: '2026-09-18', batch: 1, actions: [{ kind: 'claimed', date: '2026-09-21' }, { kind: 'restored', date: '2026-10-14', batch: 3 }, { kind: 'claimed', date: '2026-10-15' }] },
    { imported: '2026-09-18', batch: 1, actions: [{ kind: 'skipped', date: '2026-10-14', batch: 3 }] },
    { imported: '2026-10-08', batch: 2, actions: [{ kind: 'claimed', date: '2026-10-09', refundStatus: 'success' }] },
    { imported: '2026-09-18', batch: 1, actions: [{ kind: 'claimed', date: '2026-09-22', refundStatus: 'processing' }, { kind: 'failed', date: '2026-10-14', batch: 3 }] },
  ];

  for (let index = 8; index < 25; index += 1) {
    const batch = index % 3 + 1;
    const imported = ['2026-09-18', '2026-10-08', '2026-10-14'][batch - 1];
    const claimedDate = batch === 1 ? '2026-09-24' : batch === 2 ? '2026-10-11' : '2026-10-15';
    scenarios.push({
      imported,
      batch,
      actions: index % 4 === 0 ? [] : [{ kind: 'claimed', date: claimedDate }],
    });
  }

  // A shared SN intentionally has a different state in each tenant.
  if (tenantIndex === 1) {
    scenarios[0] = { imported: '2026-10-08', batch: 2, actions: [{ kind: 'claimed', date: '2026-10-12' }] };
  }
  return scenarios;
};

const buildDeviceHistory = (customer, tenantIndex, scenario, index) => {
  const sn = `XMSN2026${String(index + 1).padStart(5, '0')}`;
  const product = productDefinitions[scenario.batch === 2 ? 0 : 1];
  const prefix = tenantIndex === 0 ? 'LM' : 'XZ';
  const initialAt = stamp(scenario.imported);
  const initialBatchId = batchId(tenantIndex, scenario.batch);
  const device = {
    tenantId: customer.id,
    sn,
    productId: product.productId,
    productName: product.productName,
    benefitName: product.benefitName,
    claimStatus: 'unclaimed',
    benefitStatus: 'inactive',
    startAt: null,
    endAt: null,
    claimedAt: null,
    userId: null,
    batchId: initialBatchId,
    createdAt: initialAt,
    updatedAt: initialAt,
    claimCount: 0,
    remainingClaims: 1,
  };
  const deviceOrders = [];
  const deviceEvents = [{
    id: `EV-${prefix}-${pad(index + 1)}-001`,
    tenantId: customer.id,
    sn,
    kind: 'imported',
    title: '首次导入，获得领取资格',
    description: `通过 ${initialBatchId} 加入 SN 白名单，可领取一次${product.benefitName}。`,
    at: initialAt,
  }];
  const deviceItems = [{
    id: `BI-${prefix}-${pad(index + 1)}-001`,
    tenantId: customer.id,
    batchId: initialBatchId,
    sn,
    result: 'added',
    beforeStatus: 'not_imported',
    afterStatus: 'unclaimed',
    quotaUsed: 0,
    reason: 'SN 首次入库，新增一条设备记录并获得一次领取资格。',
    processedAt: initialAt,
  }];

  scenario.actions.forEach((action, actionIndex) => {
    const at = stamp(action.date, action.kind === 'claimed' ? '14:26:18' : '09:30:00');
    const sequence = pad(actionIndex + 2);
    const beforeStatus = device.claimStatus;
    const itemBase = {
      id: `BI-${prefix}-${pad(index + 1)}-${sequence}`,
      tenantId: customer.id,
      batchId: action.batch ? batchId(tenantIndex, action.batch) : initialBatchId,
      sn,
      beforeStatus,
      processedAt: at,
    };
    const eventBase = {
      id: `EV-${prefix}-${pad(index + 1)}-${sequence}`,
      tenantId: customer.id,
      sn,
      kind: action.kind,
      at,
    };

    if (action.kind === 'claimed') {
      device.claimCount += 1;
      device.claimStatus = 'claimed';
      device.benefitStatus = addDays(action.date, product.duration) < today ? 'expired' : 'active';
      device.claimedAt = at;
      device.startAt = stamp(action.date, '14:26:18');
      device.endAt = stamp(addDays(action.date, product.duration), '14:26:18');
      device.userId = `demo_u_${tenantIndex + 1}${pad(index + 1, 4)}${device.claimCount}`;
      device.remainingClaims = 0;
      const orderId = `ORD-${prefix}-${pad(index + 1)}-${pad(device.claimCount)}`;
      deviceOrders.push({
        id: orderId,
        tenantId: customer.id,
        sn,
        thirdPartyOrderId: `DEMO-${prefix}-${action.date.replaceAll('-', '')}-${pad(index + 1)}-${device.claimCount}`,
        platformOrderId: `XM-DEMO-${prefix}-${pad(index + 1)}-${pad(device.claimCount)}`,
        userId: device.userId,
        activityCode: `DEMO-ACT-${prefix}-2026`,
        createdAt: at,
        status: 'success',
        refundStatus: action.refundStatus ?? 'none',
        benefitName: product.benefitName,
        shareRatio: 0.5,
        amount: product.amount,
      });
      deviceEvents.push({
        ...eventBase,
        title: device.claimCount > 1 ? '再次领取成功' : '首次领取成功',
        description: `关联订单 ${orderId}，本次领取后剩余领取次数为 0。`,
      });
      if (device.benefitStatus === 'expired') {
        deviceEvents.push({
          ...eventBase,
          id: `${eventBase.id}-EXP`,
          kind: 'expired',
          title: '权益已到期',
          description: '权益有效期结束；领取资格不会因到期自动恢复。',
          at: device.endAt,
        });
      }
    } else if (action.kind === 'restored') {
      deviceOrders.at(-1).status = 'closed';
      device.claimStatus = 'restored';
      device.benefitStatus = 'inactive';
      device.startAt = null;
      device.endAt = null;
      device.remainingClaims = 1;
      deviceItems.push({
        ...itemBase,
        result: 'restored',
        afterStatus: 'restored',
        quotaUsed: 1,
        reason: '已领取设备退权益成功，恢复一次领取资格，扣减商品额度 1；不产生真实退款。',
      });
      deviceEvents.push({
        ...eventBase,
        title: '退权益成功，恢复一次领取资格',
        description: `由 ${itemBase.batchId} 触发，扣减商品 ${product.productId} 的额度 1，不涉及资金退款。`,
      });
    } else if (action.kind === 'skipped') {
      deviceItems.push({
        ...itemBase,
        result: 'skipped',
        afterStatus: beforeStatus,
        quotaUsed: 0,
        reason: 'SN 已导入且尚未领取，跳过重复写入，状态保持不变。',
      });
      deviceEvents.push({
        ...eventBase,
        title: '重复导入已跳过',
        description: '设备尚未领取权益，本次导入不增加设备记录或领取次数。',
      });
    } else if (action.kind === 'failed') {
      deviceItems.push({
        ...itemBase,
        result: 'failed',
        afterStatus: beforeStatus,
        quotaUsed: 0,
        reason: '商品剩余额度不足，退权益失败，未恢复领取资格。',
      });
      deviceEvents.push({
        ...eventBase,
        title: '退权益失败',
        description: '商品剩余额度不足；原权益状态和领取次数保持不变。',
      });
    }
    device.updatedAt = deviceEvents.map((event) => event.at).sort().at(-1);
  });

  return { device, orders: deviceOrders, events: deviceEvents, batchItems: deviceItems };
};

const histories = customers.flatMap((customer, tenantIndex) =>
  makeScenarios(tenantIndex).map((scenario, index) => buildDeviceHistory(customer, tenantIndex, scenario, index)),
);

export const devices = histories.map((history) => history.device);
export const orders = histories.flatMap((history) => history.orders);
export const events = histories.flatMap((history) => history.events);
export const batchItems = histories.flatMap((history) => history.batchItems);

const normalized = (value) => String(value ?? '').trim().toLowerCase();
const tokens = (query) => String(query ?? '').split(/[\n,，;；]+/u).map(normalized).filter(Boolean);
const matchesText = (row, query, fields) => {
  const parts = tokens(query);
  return parts.length === 0 || parts.some((part) => fields.some((field) => normalized(row[field]).includes(part)));
};
const withinDates = (value, from, to) => {
  const day = value.slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
};
const newestFirst = (field) => (left, right) => right[field].localeCompare(left[field]);

export const resolveCustomer = (appkey) =>
  customers.find((customer) => customer.appkey === String(appkey ?? '').trim()) ?? null;

export const queryDevices = ({ tenantId, query = '', exactMatch = false, claimStatus = '', benefitStatus = '', productId = '', from = '', to = '' } = {}) => {
  const parts = tokens(query);
  return devices.filter((device) =>
    device.tenantId === tenantId &&
    (!claimStatus || device.claimStatus === claimStatus) &&
    (!benefitStatus || device.benefitStatus === benefitStatus) &&
    (!productId || device.productId === productId) &&
    withinDates(device.createdAt, from, to) &&
    (exactMatch || parts.length > 1
      ? parts.includes(normalized(device.sn))
      : matchesText(device, query, ['sn', 'productId', 'productName', 'benefitName', 'userId', 'batchId'])),
  );
};

export const queryBatches = ({ tenantId, query = '', from = '', to = '' } = {}) =>
  batches.filter((batch) =>
    batch.tenantId === tenantId &&
    withinDates(batch.createdAt, from, to) &&
    (matchesText(batch, query, ['id', 'fileName', 'productId']) ||
      batchItems.some((item) => item.tenantId === tenantId && item.batchId === batch.id && matchesText(item, query, ['sn']))),
  ).sort(newestFirst('createdAt'));

export const queryOrders = ({ tenantId, query = '', status = '', refundStatus = '', from = '', to = '' } = {}) =>
  orders.filter((order) =>
    order.tenantId === tenantId &&
    (!status || order.status === status) &&
    (!refundStatus || order.refundStatus === refundStatus) &&
    withinDates(order.createdAt, from, to) &&
    matchesText(order, query, ['id', 'sn', 'thirdPartyOrderId', 'platformOrderId', 'userId', 'activityCode', 'benefitName']),
  ).sort(newestFirst('createdAt'));

export const getBatchSummary = (id, tenantId) =>
  batchItems.filter((item) => item.batchId === id && item.tenantId === tenantId).reduce((summary, item) => ({
    ...summary,
    total: summary.total + 1,
    [item.result]: summary[item.result] + 1,
    quotaUsed: summary.quotaUsed + item.quotaUsed,
  }), { total: 0, added: 0, skipped: 0, restored: 0, failed: 0, quotaUsed: 0 });

export const getDeviceDetail = (tenantId, sn) => {
  const device = devices.find((item) => item.tenantId === tenantId && item.sn === sn);
  if (!device) return null;
  const belongsToDevice = (item) => item.tenantId === tenantId && item.sn === sn;
  return {
    device,
    orders: orders.filter(belongsToDevice).sort(newestFirst('createdAt')),
    events: events.filter(belongsToDevice).sort(newestFirst('at')),
    batchItems: batchItems.filter(belongsToDevice).sort(newestFirst('processedAt')),
  };
};

const csvCell = (value) => {
  let text = value == null ? '' : String(value);
  // Quoting alone does not stop spreadsheet programs from evaluating a formula.
  if (typeof value === 'string' && /^(?:[\t\r\n]|\s*[=+@-])/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export const toCsv = (rows, columns) => '\uFEFF' + [
  columns.map(({ label }) => csvCell(label)).join(','),
  ...rows.map((row) => columns.map(({ key }) => csvCell(row[key])).join(',')),
].join('\r\n');
