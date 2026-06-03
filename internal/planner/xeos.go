package planner

import "fmt"

// XEOSPlanner implements XSKY XEOS object storage planning
type XEOSPlanner struct{}

const (
	xeosDisksPerServer   = 32
	xeosSpaceOverhead    = 0.81
	xeosEC82Efficiency   = 0.8
	xeosEC42Efficiency   = 0.6667
	xeosUploadBWPerDisk  = 30.0  // MiB/s (4MiB object)
	xeosDownloadBWPerDisk = 60.0 // MiB/s (4MiB object)
	xeosUploadOPSPerDisk  = 100  // OPS (4KiB object)
	xeosDownloadOPSPerDisk = 300 // OPS (4KiB object)
)

var xeosDiskSizes = []int{24, 22, 20, 18, 16, 12, 10, 8}

type xeosECScheme struct {
	Scheme     string
	Efficiency float64
	Tolerance  int
}

func (p *XEOSPlanner) Name() string {
	return "XSKY XEOS"
}

func getXEOSECScheme(serverCount int) xeosECScheme {
	if serverCount <= 4 {
		return xeosECScheme{"EC4+2:1", xeosEC42Efficiency, 1}
	}
	if serverCount == 5 {
		return xeosECScheme{"EC8+2:1", xeosEC82Efficiency, 1}
	}
	if serverCount <= 9 {
		return xeosECScheme{"EC4+2", xeosEC42Efficiency, 2}
	}
	return xeosECScheme{"EC8+2", xeosEC82Efficiency, 2}
}

func xeosActualCapacity(serverCount, diskSizeTB int, efficiency float64) float64 {
	diskSizeTiB := float64(diskSizeTB) * TBToTiB
	return float64(serverCount) * xeosDisksPerServer * diskSizeTiB * xeosSpaceOverhead * efficiency
}

func (p *XEOSPlanner) Plan(req PlanRequest) (*StoragePlan, error) {
	capacityTiB, _, err := ParseCapacity(req.Capacity)
	if err != nil {
		return nil, err
	}

	var uploadBWReq, downloadBWReq float64
	var uploadOPSReq, downloadOPSReq int

	if req.Performance != nil {
		if req.Performance.WriteBandwidth != "" {
			uploadBWReq, _, err = ParseBandwidth(req.Performance.WriteBandwidth)
			if err != nil {
				return nil, err
			}
		}
		if req.Performance.ReadBandwidth != "" {
			downloadBWReq, _, err = ParseBandwidth(req.Performance.ReadBandwidth)
			if err != nil {
				return nil, err
			}
		}
		uploadOPSReq = req.Performance.WriteIOPS
		downloadOPSReq = req.Performance.ReadIOPS
	}

	minServersForPerf := xeosMinServersForPerf(uploadBWReq, downloadBWReq, uploadOPSReq, downloadOPSReq)

	type config struct {
		serverCount int
		diskSize    int
		ec          xeosECScheme
		capacity    float64
	}

	var configs []config

	for _, diskSize := range xeosDiskSizes {
		for servers := 3; servers <= 50; servers++ {
			ec := getXEOSECScheme(servers)
			actual := xeosActualCapacity(servers, diskSize, ec.Efficiency)

			if actual >= capacityTiB && servers >= minServersForPerf {
				configs = append(configs, config{servers, diskSize, ec, actual})
				break
			}
		}
	}

	if len(configs) == 0 {
		return nil, fmt.Errorf("cannot find a configuration that meets all requirements")
	}

	best := configs[0]
	bestScore := scoreXEOSConfig(best.serverCount, best.ec.Efficiency, best.capacity, capacityTiB)
	for _, c := range configs[1:] {
		s := scoreXEOSConfig(c.serverCount, c.ec.Efficiency, c.capacity, capacityTiB)
		if s < bestScore {
			best = c
			bestScore = s
		}
	}

	totalDisks := best.serverCount * xeosDisksPerServer
	uploadBW := float64(totalDisks) * xeosUploadBWPerDisk
	downloadBW := float64(totalDisks) * xeosDownloadBWPerDisk
	uploadOPS := totalDisks * xeosUploadOPSPerDisk
	downloadOPS := totalDisks * xeosDownloadOPSPerDisk

	return &StoragePlan{
		Solution:    "XSKY XEOS",
		ServerCount: best.serverCount,
		Capacity: CapacityResult{
			UsableCapacity:    best.capacity,
			EffectiveCapacity: best.capacity,
			Unit:              "TiB",
		},
		Performance: PerformanceResult{
			WriteBandwidth: uploadBW * 8.388608 / 1000, // Gbps
			ReadBandwidth:  downloadBW * 8.388608 / 1000,
			WriteIOPS:      uploadOPS,
			ReadIOPS:       downloadOPS,
			BandwidthUnit:  "Gbps",
		},
		Configuration: map[string]string{
			"ecScheme":  best.ec.Scheme,
			"tolerance": fmt.Sprintf("%d node(s)", best.ec.Tolerance),
			"diskSize":  fmt.Sprintf("%dTB", best.diskSize),
			"diskCount": fmt.Sprintf("%d per server", xeosDisksPerServer),
		},
	}, nil
}

func xeosMinServersForPerf(uploadBW, downloadBW float64, uploadOPS, downloadOPS int) int {
	needs := []float64{
		uploadBW / xeosUploadBWPerDisk,
		downloadBW / xeosDownloadBWPerDisk,
		float64(uploadOPS) / xeosUploadOPSPerDisk,
		float64(downloadOPS) / xeosDownloadOPSPerDisk,
	}
	maxDisks := 0.0
	for _, n := range needs {
		if n > maxDisks {
			maxDisks = n
		}
	}
	if maxDisks == 0 {
		return 0
	}
	return RoundUp(maxDisks / xeosDisksPerServer)
}

func scoreXEOSConfig(serverCount int, ecEfficiency, actualCapacity, requiredCapacity float64) float64 {
	overProvision := actualCapacity / requiredCapacity
	return float64(serverCount)*1000 + (1-ecEfficiency)*100 + overProvision
}
