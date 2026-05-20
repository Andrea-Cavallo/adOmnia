package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var version = "dev"

var rootCmd = &cobra.Command{
	Use:   "adOmnia",
	Short: "adOmnia CLI — API testing, mock server, load testing",
	Long:  "adOmnia CLI: run collections headless, start mock servers, execute load tests from the terminal.",
}

func init() {
	rootCmd.AddCommand(runCmd)
	rootCmd.AddCommand(mockCmd)
	rootCmd.AddCommand(loadtestCmd)
	rootCmd.AddCommand(versionCmd)
}

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print version information",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("adOmnia CLI %s\n", version)
	},
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}
