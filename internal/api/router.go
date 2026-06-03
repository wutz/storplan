package api

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/wutz/storplan/internal/planner"
)

func NewRouter() *gin.Engine {
	r := gin.Default()

	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	r.POST("/api/plan", handlePlan)

	return r
}

func handlePlan(c *gin.Context) {
	var req planner.PlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	p, err := getPlanner(req.Storage)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := p.Plan(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

func getPlanner(storage string) (planner.Planner, error) {
	switch storage {
	case "xeos":
		return &planner.XEOSPlanner{}, nil
	default:
		return nil, fmt.Errorf("unsupported storage type: %s (supported: xeos)", storage)
	}
}
