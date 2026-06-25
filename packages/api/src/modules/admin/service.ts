import { AppError, ErrorCode, type Role } from '@proxyclaude/shared';
import { Prisma, type PrismaClient, type User } from '@prisma/client';
import { hashPassword } from '../../lib/hash.js';

export interface UserDto {
  id: string;
  email: string;
  role: Role;
  status: 'ACTIVE' | 'DISABLED';
  vpsUsername: string | null;
  createdAt: Date;
}

export function toUserDto(u: User): UserDto {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    status: u.status,
    vpsUsername: u.vpsUsername,
    createdAt: u.createdAt,
  };
}

/**
 * Admin operations on users (plan §10). All callers are gated to ADMIN by the
 * route's requireRole preHandler; this layer assumes authorization is done.
 */
export class AdminUserService {
  constructor(private readonly prisma: PrismaClient) {}

  async createUser(email: string, password: string, role: Role): Promise<UserDto> {
    const passwordHash = await hashPassword(password);
    try {
      const user = await this.prisma.user.create({
        data: { email, passwordHash, role, status: 'ACTIVE' },
      });
      return toUserDto(user);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(ErrorCode.CONFLICT, 'A user with this email already exists');
      }
      throw err;
    }
  }

  /** Disable a user. Idempotent. Disabled users cannot log in or refresh. */
  async disableUser(id: string): Promise<UserDto> {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: { status: 'DISABLED' },
    });
    // Revoke all active refresh tokens so existing sessions cannot be renewed.
    await this.prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return toUserDto(user);
  }

  /** List users, optionally filtered to an exact email (for CLI email→id lookup). */
  async listUsers(email?: string): Promise<UserDto[]> {
    const users = await this.prisma.user.findMany({
      where: email ? { email } : undefined,
      orderBy: { createdAt: 'asc' },
    });
    return users.map(toUserDto);
  }
}
