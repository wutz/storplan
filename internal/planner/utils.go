package planner

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

const (
	TBToTiB = 0.909
)

// ParseCapacity parses capacity string like "500TiB", "2PB" into TiB
func ParseCapacity(input string) (float64, string, error) {
	re := regexp.MustCompile(`(?i)^([\d.]+)\s*(TB|PB|TiB|PiB)$`)
	matches := re.FindStringSubmatch(strings.TrimSpace(input))
	if matches == nil {
		return 0, "", fmt.Errorf("invalid capacity format: %s, use format like \"500TB\" or \"1.5PiB\"", input)
	}

	value, err := strconv.ParseFloat(matches[1], 64)
	if err != nil {
		return 0, "", fmt.Errorf("invalid numeric value: %s", matches[1])
	}

	unit := strings.ToUpper(matches[2])
	var tib float64

	switch unit {
	case "TB":
		tib = value * TBToTiB
	case "PB":
		tib = value * 1000 * TBToTiB
	case "TIB":
		tib = value
	case "PIB":
		tib = value * 1024
	default:
		return 0, "", fmt.Errorf("unsupported unit: %s", unit)
	}

	return tib, unit, nil
}

// ParseBandwidth parses bandwidth string into MiB/s
func ParseBandwidth(input string) (float64, string, error) {
	re := regexp.MustCompile(`(?i)^([\d.]+)\s*(MB/s|GB/s|MiB/s|GiB/s|Mbps|Gbps)$`)
	matches := re.FindStringSubmatch(strings.TrimSpace(input))
	if matches == nil {
		return 0, "", fmt.Errorf("invalid bandwidth format: %s", input)
	}

	value, err := strconv.ParseFloat(matches[1], 64)
	if err != nil {
		return 0, "", fmt.Errorf("invalid numeric value: %s", matches[1])
	}

	unit := matches[2]
	unitLower := strings.ToLower(unit)
	var mibps float64

	switch unitLower {
	case "mb/s":
		mibps = value / 1.024
	case "gb/s":
		mibps = value * 1000 / 1.024
	case "mib/s":
		mibps = value
	case "gib/s":
		mibps = value * 1024
	case "mbps":
		mibps = value / 8.388608
	case "gbps":
		mibps = value * 1000 / 8.388608
	default:
		return 0, "", fmt.Errorf("unsupported bandwidth unit: %s", unit)
	}

	return mibps, unit, nil
}

// FormatCapacity formats TiB value to readable string
func FormatCapacity(tib float64, preferBinary bool) string {
	if preferBinary {
		if tib >= 1024 {
			return fmt.Sprintf("%.2f PiB", tib/1024)
		}
		return fmt.Sprintf("%.2f TiB", tib)
	}
	tb := tib / TBToTiB
	if tb >= 1000 {
		return fmt.Sprintf("%.2f PB", tb/1000)
	}
	return fmt.Sprintf("%.2f TB", tb)
}

// FormatBandwidthGbps formats MiB/s to Gbps
func FormatBandwidthGbps(mibps float64) string {
	mbps := mibps * 8.388608
	if mbps >= 1000 {
		return fmt.Sprintf("%.2f Gbps", mbps/1000)
	}
	return fmt.Sprintf("%.2f Mbps", mbps)
}

// RoundUp is a helper to round up to nearest integer
func RoundUp(v float64) int {
	return int(math.Ceil(v))
}
