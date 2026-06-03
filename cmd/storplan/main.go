package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/wutz/storplan/internal/planner"
)

var rootCmd = &cobra.Command{
	Use:   "storplan",
	Short: "Storage capacity and performance planning tool",
}

var planCmd = &cobra.Command{
	Use:   "plan",
	Short: "Plan storage capacity and performance",
	RunE:  runPlan,
}

var (
	flagStorage     string
	flagCapacity    string
	flagReadBW      string
	flagWriteBW     string
	flagReadIOPS    int
	flagWriteIOPS   int
	flagJSON        bool
)

func init() {
	planCmd.Flags().StringVar(&flagStorage, "storage", "", "Storage type: xeos, gpfs-ece, vastdata, weka")
	planCmd.Flags().StringVar(&flagCapacity, "capacity", "", "Capacity requirement (e.g., 500TiB, 2PB)")
	planCmd.Flags().StringVar(&flagReadBW, "read-bw", "", "Read bandwidth requirement (e.g., 10Gbps)")
	planCmd.Flags().StringVar(&flagWriteBW, "write-bw", "", "Write bandwidth requirement (e.g., 10Gbps)")
	planCmd.Flags().IntVar(&flagReadIOPS, "read-iops", 0, "Read IOPS requirement")
	planCmd.Flags().IntVar(&flagWriteIOPS, "write-iops", 0, "Write IOPS requirement")
	planCmd.Flags().BoolVar(&flagJSON, "json", false, "Output as JSON")

	planCmd.MarkFlagRequired("storage")
	planCmd.MarkFlagRequired("capacity")

	rootCmd.AddCommand(planCmd)
}

func runPlan(cmd *cobra.Command, args []string) error {
	req := planner.PlanRequest{
		Storage:  flagStorage,
		Capacity: flagCapacity,
	}

	if flagReadBW != "" || flagWriteBW != "" || flagReadIOPS > 0 || flagWriteIOPS > 0 {
		req.Performance = &planner.PerformanceReq{
			ReadBandwidth:  flagReadBW,
			WriteBandwidth: flagWriteBW,
			ReadIOPS:       flagReadIOPS,
			WriteIOPS:      flagWriteIOPS,
		}
	}

	var p planner.Planner
	switch req.Storage {
	case "xeos":
		p = &planner.XEOSPlanner{}
	default:
		return fmt.Errorf("unsupported storage type: %s (supported: xeos)", req.Storage)
	}

	result, err := p.Plan(req)
	if err != nil {
		return err
	}

	if flagJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(result)
	}

	printResult(result)
	return nil
}

func printResult(plan *planner.StoragePlan) {
	fmt.Printf("\n=== %s 存储规划方案 ===\n\n", plan.Solution)
	fmt.Printf("配置方案:\n")
	fmt.Printf("  服务器台数: %d 台\n", plan.ServerCount)
	if v, ok := plan.Configuration["ecScheme"]; ok {
		fmt.Printf("  纠删码方案: %s（容忍 %s 离线）\n", v, plan.Configuration["tolerance"])
	}
	if v, ok := plan.Configuration["diskSize"]; ok {
		fmt.Printf("  磁盘配置: %s × %s HDD\n", plan.Configuration["diskCount"], v)
	}
	fmt.Printf("\n容量:\n")
	fmt.Printf("  可用容量: %.2f %s\n", plan.Capacity.UsableCapacity, plan.Capacity.Unit)
	fmt.Printf("\n性能:\n")
	fmt.Printf("  上传带宽: %.2f %s (4MiB)\n", plan.Performance.WriteBandwidth, plan.Performance.BandwidthUnit)
	fmt.Printf("  下载带宽: %.2f %s (4MiB)\n", plan.Performance.ReadBandwidth, plan.Performance.BandwidthUnit)
	fmt.Printf("  上传 OPS: %d (4KiB)\n", plan.Performance.WriteIOPS)
	fmt.Printf("  下载 OPS: %d (4KiB)\n", plan.Performance.ReadIOPS)
	fmt.Println()
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}
