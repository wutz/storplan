package planner

// StoragePlan represents a storage planning result
type StoragePlan struct {
	Solution      string            `json:"solution"`
	ServerCount   int               `json:"serverCount"`
	Capacity      CapacityResult    `json:"capacity"`
	Performance   PerformanceResult `json:"performance"`
	Configuration map[string]string `json:"configuration"`
}

// CapacityResult represents capacity metrics
type CapacityResult struct {
	RawCapacity       float64 `json:"rawCapacity"`       // TB
	UsableCapacity    float64 `json:"usableCapacity"`    // TB
	EffectiveCapacity float64 `json:"effectiveCapacity"` // TB
	Unit              string  `json:"unit"`              // TB or TiB
}

// PerformanceResult represents performance metrics
type PerformanceResult struct {
	ReadBandwidth   float64 `json:"readBandwidth"`   // Gbps or GiB/s
	WriteBandwidth  float64 `json:"writeBandwidth"`  // Gbps or GiB/s
	ReadIOPS        int     `json:"readIOPS"`        // IOPS
	WriteIOPS       int     `json:"writeIOPS"`       // IOPS
	BandwidthUnit   string  `json:"bandwidthUnit"`   // Gbps or GiB/s
}

// PlanRequest represents a planning request
type PlanRequest struct {
	Storage   string             `json:"storage"`   // gpfs-ece, xeos, vastdata, weka
	Capacity  string             `json:"capacity"`  // e.g., "500TiB", "2PB"
	Performance *PerformanceReq  `json:"performance,omitempty"`
}

// PerformanceReq represents performance requirements
type PerformanceReq struct {
	ReadBandwidth  string `json:"readBandwidth,omitempty"`  // e.g., "10Gbps", "1GiB/s"
	WriteBandwidth string `json:"writeBandwidth,omitempty"` // e.g., "10Gbps", "1GiB/s"
	ReadIOPS       int    `json:"readIOPS,omitempty"`
	WriteIOPS      int    `json:"writeIOPS,omitempty"`
}

// Planner interface for different storage solutions
type Planner interface {
	Plan(req PlanRequest) (*StoragePlan, error)
	Name() string
}
