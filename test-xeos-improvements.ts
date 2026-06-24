import { planXEOS, calculateCacheConfig, calculatePoolConfig, buildUltraLargeFromServers, CONSTANTS, getAllowedEcSchemes } from './src/lib/xeos'

console.log('=== XSKY XEOS 改进测试（第二版）===\n')

// 测试 1: HDD 数量可选
console.log('1. HDD 数量可选列表:', CONSTANTS.DISKS_PER_SERVER_OPTIONS)
console.log('   预期: [24, 26, 28, 30, 32, 34, 36]\n')

// 测试 2: 10 台及以上时纠删码只允许选择 EC8+2
console.log('2. 纠删码方案限制测试')
const ecTests = [
  { servers: 3, expected: 'EC4+2:1' },
  { servers: 5, expected: 'EC8+2:1, EC4+2' },
  { servers: 10, expected: 'EC8+2 (仅一种)' },
  { servers: 20, expected: 'EC8+2 (仅一种)' },
]

ecTests.forEach(test => {
  const schemes = getAllowedEcSchemes(test.servers)
  console.log(`   ${test.servers} 台: ${schemes.map(s => s.scheme).join(', ')}`)
})
console.log()

// 测试 3: 索引缓存盘配置（可调整数量和单盘大小）
console.log('3. 索引缓存盘配置测试')
const cacheTests = [
  { disksPerServer: 24, diskSize: 24, expected: '单台需要 7.2TB 缓存' },
  { disksPerServer: 32, diskSize: 20, expected: '单台需要 8TB 缓存' },
  { disksPerServer: 36, diskSize: 18, expected: '单台需要 8.1TB 缓存' },
]

cacheTests.forEach(test => {
  const cache = calculateCacheConfig(test.disksPerServer, test.diskSize)
  const requiredTB = (test.disksPerServer * test.diskSize) / CONSTANTS.CACHE_RATIO
  console.log(`   ${test.disksPerServer} × ${test.diskSize}TB HDD:`)
  console.log(`     需求: ${requiredTB.toFixed(2)}TB`)
  console.log(`     配置: ${cache.count} × ${cache.sizePerDisk}TB = ${cache.totalSize}TB`)
  console.log(`     满足要求: ${cache.totalSize >= requiredTB ? '✓' : '✗'}`)
})
console.log()

// 测试 4: 容错能力 = 2 × 池数（需要至少 40 台才分池）
console.log('4. 容错能力测试（2 × 池数）')
const poolTests = [
  { servers: 10, expected: '不分池' },
  { servers: 20, expected: '不分池' },
  { servers: 24, expected: '不分池' },
  { servers: 32, expected: '不分池' },
  { servers: 40, expected: '分池' },
  { servers: 50, expected: '分池' },
]

poolTests.forEach(test => {
  const pool = calculatePoolConfig(test.servers, 'EC8+2')
  console.log(`   ${test.servers} 台服务器:`)
  if (pool) {
    console.log(`     ✓ 分池: ${pool.poolCount} 个池`)
    console.log(`     配置: ${pool.serversPerPool.join(' + ')} 台`)
    console.log(`     容错: ${pool.totalTolerance} 台 (2 × ${pool.poolCount})`)
  } else {
    console.log(`     ✗ ${test.expected} (< 40 台)，容错: 1 台`)
  }
})
console.log()

// 测试 5: 集群 HDD 总数上限检查
console.log('5. 集群 HDD 总数上限测试')
console.log(`   上限: ${CONSTANTS.MAX_TOTAL_DISKS} 块`)
try {
  const result = planXEOS({ capacity: '10000TiB' })
  const totalDisks = result.serverCount * result.disksPerServer
  console.log(`   10PiB 配置: ${result.serverCount} 台 × ${result.disksPerServer} 块 = ${totalDisks} 块`)
  if (totalDisks > CONSTANTS.MAX_TOTAL_DISKS) {
    console.log('   ⚠️  超出上限！')
  } else {
    console.log('   ✓ 未超限')
  }
} catch (err) {
  console.log('   配置超出上限，无法满足:', err instanceof Error ? err.message : err)
}
console.log()

// 测试 6: 完整方案测试
console.log('6. 完整规划方案测试')
const fullTest = planXEOS({ capacity: '2000TiB' })
console.log(`   可用容量: ${fullTest.formatted.capacity}`)
console.log(`   裸容量: ${fullTest.formatted.rawCapacity}`)
console.log(`   服务器: ${fullTest.serverCount} 台`)
console.log(`   每台 HDD: ${fullTest.disksPerServer} 块 × ${fullTest.diskSize}TB`)
console.log(`   集群 HDD 总数: ${fullTest.serverCount * fullTest.disksPerServer} 块`)
console.log(`   纠删码: ${fullTest.ecScheme}`)
console.log(`   容忍离线: ${fullTest.tolerance} 台`)
console.log(`   索引缓存盘: ${fullTest.cacheConfig.count} × ${fullTest.cacheConfig.sizePerDisk}TB = ${fullTest.cacheConfig.totalSize}TB`)
const requiredCache = (fullTest.disksPerServer * fullTest.diskSize) / CONSTANTS.CACHE_RATIO
console.log(`   缓存要求: ≥ ${requiredCache.toFixed(2)}TB (${fullTest.cacheConfig.totalSize >= requiredCache ? '✓ 满足' : '✗ 不足'})`)
if (fullTest.poolConfig) {
  console.log(`   分池: ${fullTest.poolConfig.poolCount} 个池`)
  console.log(`   容错能力: ${fullTest.poolConfig.totalTolerance} 台 (2 × ${fullTest.poolConfig.poolCount})`)
} else {
  console.log(`   分池: 不分池`)
}
console.log(`   下载 BW: ${fullTest.formatted.downloadBandwidth}`)
console.log(`   上传 BW: ${fullTest.formatted.uploadBandwidth}`)
console.log()

// 测试 7: 超大规模集群（2000–20000 HDD 两级架构）
console.log('7. 超大规模集群测试（2000–20000 HDD）')
const ultraTests = ['50PiB', '100PiB', '250PiB']
ultraTests.forEach(cap => {
  const r = planXEOS({ capacity: cap })
  if (r.ultraLarge) {
    const ul = r.ultraLarge
    const mc = ul.metadataCluster
    // 元数据节点数 = clamp(ceil(数据节点/25), 6, 20)
    const expectedNodes = Math.min(CONSTANTS.MAX_METADATA_NODES, Math.max(CONSTANTS.MIN_METADATA_NODES, Math.ceil(ul.tier2ServersTotal / CONSTANTS.METADATA_NODE_RATIO - 1e-9)))
    const nodeOk = mc.nodeCount === expectedNodes && mc.nodeCount >= 6 && mc.nodeCount <= 20
    const ecOk = mc.ecScheme === (mc.nodeCount >= 10 ? 'EC8+2' : 'EC4+2')
    const diskOk = CONSTANTS.METADATA_DISK_COUNTS.includes(mc.disksPerNode as any) && CONSTANTS.METADATA_DISK_SIZES.includes(mc.diskSize as any)
    const ok = ul.tier2TotalHDDs <= CONSTANTS.MAX_TOTAL_DISKS_ULTRA && nodeOk && ecOk && diskOk
    console.log(`   ${cap}: 二级 ${ul.tier2ClusterCount} 簇 × 40 节点 = ${ul.tier2ServersTotal} 台, HDD ${ul.tier2TotalHDDs} 块`)
    console.log(`     可用容量 ${r.formatted.capacity} | 二级 SSD 总容量 ${ul.tier2CacheSSDTotal.toLocaleString()} TB`)
    console.log(`     一级元数据 ${mc.nodeCount} 台 (期望 ${expectedNodes}) × ${mc.disksPerNode}×${mc.diskSize}TB NVMe = ${mc.totalSize.toLocaleString()} TB (${mc.ecScheme})`)
    console.log(`     比例 二级SSD/一级NVMe = ${ul.ratio.toFixed(2)} (目标 5，受节点数 6–20 与单盘上限夹紧)`)
    console.log(`     ${ok ? '✓ 通过' : '✗ 失败'}`)
  } else {
    console.log(`   ${cap}: ✗ 未进入超大规模模式`)
  }
})
console.log()

// 测试 8: 超过 20000 HDD 上限 -> 联系 XSKY 技术支持
console.log('8. 超过 20000 HDD 上限测试')
try {
  planXEOS({ capacity: '300PiB' })
  console.log('   ✗ 未抛出错误')
} catch (err) {
  console.log(`   ✓ 300PiB 抛出: ${err instanceof Error ? err.message : err}`)
}
console.log()

// 测试 9: 回归 - 单集群仍正常（不进入超大规模）
console.log('9. 单集群回归测试')
const regTests = ['500TiB', '2000TiB']
regTests.forEach(cap => {
  const r = planXEOS({ capacity: cap })
  console.log(`   ${cap}: ${r.ultraLarge ? '✗ 误判超大规模' : '✓ 单集群'} | ${r.serverCount} 台 × ${r.disksPerServer}×${r.diskSize}TB | ${r.formatted.capacity}`)
})
console.log()

// 测试 10: 手动服务器台数 × 每台 HDD 超 2000 -> 超大规模（含一级元数据集群）
console.log('10. 手动服务器台数超大规模测试')
const manualTests = [
  { servers: 56, disks: 36, size: 24 },   // 56×36=2016 > 2000
  { servers: 300, disks: 36, size: 24 },  // 300×36=10800
]
manualTests.forEach(t => {
  const cache = calculateCacheConfig(t.disks, t.size)
  const r = buildUltraLargeFromServers(t.servers, t.disks, t.size, cache.count, cache.sizePerDisk, true, 'decimal-bit')
  const ul = r.ultraLarge!
  const mc = ul.metadataCluster
  const expectedNodes = Math.min(CONSTANTS.MAX_METADATA_NODES, Math.max(CONSTANTS.MIN_METADATA_NODES, Math.ceil(ul.tier2ServersTotal / CONSTANTS.METADATA_NODE_RATIO - 1e-9)))
  const nodeOk = mc.nodeCount === expectedNodes
  const ecOk = mc.ecScheme === (mc.nodeCount >= 10 ? 'EC8+2' : 'EC4+2')
  console.log(`   ${t.servers} 台 × ${t.disks}×${t.size}TB (HDD ${t.servers * t.disks}):`)
  console.log(`     -> ${ul.tier2ClusterCount} 簇 × 40 = ${ul.tier2ServersTotal} 台, HDD ${ul.tier2TotalHDDs} / ${CONSTANTS.MAX_TOTAL_DISKS_ULTRA}`)
  console.log(`     一级元数据 ${mc.nodeCount} 台 (期望 ${expectedNodes}) × ${mc.disksPerNode}×${mc.diskSize}TB = ${mc.totalSize}TB (${mc.ecScheme})`)
  console.log(`     比例 ${ul.ratio.toFixed(2)} (目标 5) 节点/EC ${nodeOk && ecOk ? '✓' : '✗'}  可用容量 ${r.formatted.capacity}`)
})
console.log()

console.log('=== 测试完成 ===')
