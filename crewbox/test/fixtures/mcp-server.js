// A tiny stdio MCP server used by the tests: one read-only tool, one tool with side effects.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'get_weather', description: 'Weather for a city', inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } },
    { name: 'send_email', description: 'Send an email', inputSchema: { type: 'object', properties: { to: { type: 'string' } }, required: ['to'] } },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  if (name === 'get_weather') return { content: [{ type: 'text', text: `Sunny in ${args.city} (token ${process.env.FIXTURE_TOKEN})` }] };
  if (name === 'send_email') return { content: [{ type: 'text', text: `Email sent to ${args.to}` }] };
  return { content: [{ type: 'text', text: 'unknown' }], isError: true };
});
await server.connect(new StdioServerTransport());
