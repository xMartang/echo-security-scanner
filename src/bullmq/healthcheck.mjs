#!/usr/bin/env node
// Verifies Redis is reachable. Exits 0 if connected, 1 on failure or timeout.
import net from 'net';

const redisUrl = process.env.REDIS_URL ?? 'redis://redis:6379';
const { hostname, port } = new URL(redisUrl);

const socket = net.createConnection(Number(port) || 6379, hostname);
socket.on('connect', () => { socket.destroy(); process.exit(0); });
socket.on('error', () => process.exit(1));
setTimeout(() => process.exit(1), 3000);
