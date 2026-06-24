import { planXEOS, calculateCacheConfig, calculatePoolConfig, CONSTANTS, getAllowedEcSchemes } from './src/lib/xeos'

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

// 测试 4: 容错能力 = 2 × 池数
console.log('4. 容错能力测试（2 × 池数）')
const poolTests = [
  { servers: 10, scheme: 'EC8+2' },
  { servers: 20, scheme: 'EC8+2' },
  { servers: 24, scheme: 'EC8+2' },
  { servers: 32, scheme: 'EC8+2' },
  { servers: 50, scheme: 'EC8+2' },
]

poolTests.forEach(test => {
  const pool = calculatePoolConfig(test.servers, test.scheme)
  console.log(`   ${test.servers} 台服务器 (${test.scheme}):`)
  if (pool) {
    console.log(`     分池: ${pool.poolCount} 个池`)
    console.log(`     容错能力: ${pool.totalTolerance} 台 (2 × ${pool.poolCount})`)
  } else {
    console.log(`     不分池 (< 20 台)，容错: 1 台`)
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

console.log('=== 测试完成 ===')
