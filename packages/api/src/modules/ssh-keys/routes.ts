import { registerSshKeyRequestSchema } from '@proxyclaude/shared';
import type { FastifyInstance } from 'fastify';
import { SshKeyService } from './service.js';
import { VpsClient } from '../../lib/vps-client.js';

/**
 * SSH key routes (plan §7). Authenticated; a developer registers their own key.
 */
export default async function sshKeyRoutes(app: FastifyInstance): Promise<void> {
  const vpsConfigured =
    !!app.config.VPS_HOST &&
    !!app.config.VPS_PROVISIONER_USER &&
    !!app.config.VPS_PROVISIONER_KEY_PATH;
  const vps = vpsConfigured ? VpsClient.fromConfig(app.config) : null;
  const service = new SshKeyService(app.prisma, vps);

  app.post('/ssh-keys/register', { preHandler: app.authenticate }, async (req) => {
    const { publicKey } = registerSshKeyRequestSchema.parse(req.body);
    return service.register(req.user!.id, publicKey);
  });
}
