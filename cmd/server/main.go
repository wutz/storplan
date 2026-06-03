package main

import (
	"fmt"
	"os"

	"github.com/wutz/storplan/internal/api"
)

func main() {
	port := "8080"
	if p := os.Getenv("PORT"); p != "" {
		port = p
	}

	r := api.NewRouter()
	fmt.Printf("Starting storplan server on :%s\n", port)
	if err := r.Run(":" + port); err != nil {
		fmt.Fprintf(os.Stderr, "Server failed: %v\n", err)
		os.Exit(1)
	}
}
