package main

import (
	"log"
	"os"

	"github.com/btwiuse/codigo"
	"github.com/btwiuse/codigo/upgrade"
	"github.com/btwiuse/codigo/version"
	"github.com/btwiuse/multicall"
)

var cmdRun multicall.RunnerFuncMap = map[string]multicall.RunnerFunc{
	// version info
	"version": version.Run,
	// binary upgrade
	"upgrade": upgrade.Run,
	// start cmd
	"start": codigo.Run,
}

func main() {
	log.SetFlags(log.Ltime | log.Lshortfile)

	err := cmdRun.Run(os.Args[1:])
	if err != nil {
		log.Fatalln(err)
	}
}
