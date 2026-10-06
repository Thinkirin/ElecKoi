#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pruneForeignPackages, stageProductionClosure } from './stage-production-closure.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--output') throw new Error('Usage: node prepare-host-closure.mjs --output build/android-runtime/closure')
const output = resolve(args[1])
if (output === repo || repo.startsWith(`${output}${sep}`)) throw new Error('Closure output must not contain the repository')
if (existsSync(output) && readdirSync(output).length > 0) throw new Error(`Closure output is not empty: ${output}`)
const inventory = stageProductionClosure(repo, output, { links: false })
pruneForeignPackages(output, inventory)
const archive = `${output}.tar`
const result = spawnSync('tar', ['-cf', archive, '-C', output, '.'], { stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) throw new Error(`Production closure archive failed: ${result.status}`)
process.stdout.write(`${JSON.stringify({ output, archive, packages: inventory.packages.length })}\n`)
