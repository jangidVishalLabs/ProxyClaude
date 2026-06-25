import { z } from 'zod';
import {
  createUserRequestSchema,
  createProjectRequestSchema,
  updateProjectRequestSchema,
  assignmentRequestSchema,
} from '@proxyclaude/shared';
import type { FastifyInstance } from 'fastify';
import { AdminUserService } from './service.js';
import { AdminProjectService } from './projects.service.js';
import { ProvisioningService } from './provision.service.js';
import { SshKeyService } from '../ssh-keys/service.js';
import { VpsClient } from '../../lib/vps-client.js';
import { toProjectDto } from '../projects/service.js';

const idParamsSchema = z.object({ id: z.string().min(1) });

/**
 * Admin routes (plan §10). Every route is gated to ADMIN via requireRole.
 */
export default async function adminRoutes(app: FastifyInstance): Promise<void> {
  const users = new AdminUserService(app.prisma);
  const projects = new AdminProjectService(app.prisma);
  // Build a VpsClient only when the provisioner is fully configured; otherwise
  // provision jobs are recorded PENDING for out-of-band execution.
  const vpsConfigured =
    !!app.config.VPS_HOST &&
    !!app.config.VPS_PROVISIONER_USER &&
    !!app.config.VPS_PROVISIONER_KEY_PATH;
  const vps = vpsConfigured ? VpsClient.fromConfig(app.config) : null;
  const provisioning = new ProvisioningService(app.prisma, app.config, vps);
  const sshKeys = new SshKeyService(app.prisma, vps);
  const adminOnly = { preHandler: app.requireRole('ADMIN') };

  app.get('/admin/users', adminOnly, async (req) => {
    const { email } = z.object({ email: z.string().optional() }).parse(req.query);
    return { users: await users.listUsers(email) };
  });

  app.get('/admin/users/:id/ssh-keys', adminOnly, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return { keys: await sshKeys.listForUser(id) };
  });

  app.post('/admin/users', adminOnly, async (req, reply) => {
    const { email, password, role } = createUserRequestSchema.parse(req.body);
    const user = await users.createUser(email, password, role);
    reply.status(201);
    return user;
  });

  app.patch('/admin/users/:id/disable', adminOnly, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return users.disableUser(id);
  });

  app.post('/admin/projects', adminOnly, async (req, reply) => {
    const input = createProjectRequestSchema.parse(req.body);
    const project = await projects.createProject(input);
    reply.status(201);
    return toProjectDto(project);
  });

  app.patch('/admin/projects/:id', adminOnly, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = updateProjectRequestSchema.parse(req.body);
    const project = await projects.updateProject(id, input);
    return toProjectDto(project);
  });

  app.post('/admin/assignments', adminOnly, async (req, reply) => {
    const { userId, projectId } = assignmentRequestSchema.parse(req.body);
    const assignment = await projects.assign(userId, projectId);
    reply.status(201);
    return { id: assignment.id, userId: assignment.userId, projectId: assignment.projectId };
  });

  app.post('/admin/users/:id/provision', adminOnly, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const result = await provisioning.provisionWorkspace(id);
    reply.status(202); // accepted: job queued, VPS execution happens out-of-band
    return {
      user: result.user,
      job: { id: result.job.id, type: result.job.type, status: result.job.status },
    };
  });

  app.post('/admin/ssh-keys/:id/revoke', adminOnly, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    await sshKeys.revoke(id);
    reply.status(204).send();
  });

  app.get('/admin/audit', adminOnly, async (req) => {
    const query = z
      .object({
        action: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(req.query);
    const logs = await app.prisma.auditLog.findMany({
      where: query.action ? { action: query.action } : undefined,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return { logs };
  });
}
