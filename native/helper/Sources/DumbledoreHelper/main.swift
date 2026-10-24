// main.swift — entry point of the Dumbledore helper.
//
//   dumbledore-helper [serve] --socket <path> [--parent-pid <pid>] [--verbose]
//   dumbledore-helper ocr-file --image <png> [--scale 2]   (dev/test: OCR an image file, print JSON)
//   dumbledore-helper selftest                              (pure-logic checks, exit code 0 = pass)
//   dumbledore-helper version
import Foundation

let cli = CLIOptions(Array(CommandLine.arguments.dropFirst()))

switch cli.command {
case "version":
  print("{\"protocol\":\(helperProtocolVersion),\"version\":\"\(HelperMain.version)\"}")
  exit(0)
case "selftest":
  exit(SelfTest.run())
case "ocr-file":
  exit(OCRFileCommand.run(cli))
case "serve":
  HelperMain.run(cli)
default:
  FileHandle.standardError.write(Data("unknown command: \(cli.command)\n".utf8))
  exit(2)
}
