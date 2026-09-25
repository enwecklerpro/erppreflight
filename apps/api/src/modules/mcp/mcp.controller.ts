import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { McpService } from './mcp.service';
import { McpRpcRequestDto } from './dto/mcp.dto';

@ApiTags('Model Context Protocol (MCP)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('mcp')
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @Post()
  @ApiOperation({ summary: 'Standard JSON-RPC 2.0 endpoint for MCP Clients' })
  async handleRpc(@Req() req: any, @Body() rpc: McpRpcRequestDto) {
    const orgId = req.user.organizationId;

    if (rpc.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        result: {
          tools: this.mcpService.getToolsList(),
        },
        id: rpc.id,
      };
    }

    if (rpc.method === 'tools/call') {
      const toolName = rpc.params?.name;
      const toolArgs = rpc.params?.arguments || {};
      const toolResult = await this.mcpService.handleCall(orgId, toolName, toolArgs);

      return {
        jsonrpc: '2.0',
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(toolResult, null, 2),
            },
          ],
        },
        id: rpc.id,
      };
    }

    return {
      jsonrpc: '2.0',
      error: {
        code: -32601,
        message: `Method '${rpc.method}' not found. Supported methods: tools/list, tools/call`,
      },
      id: rpc.id,
    };
  }
}
