import { AppError, ErrorCode, type LoginResponse } from '@proxyclaude/shared';
import type { PrismaClient, User } from '@prisma/client';
import type { AppConfig } from '../../config.js';
import { verifyPassword } from '../../lib/hash.js';
import { signAccessToken } from '../../lib/jwt.js';
import { generateRefreshToken, hashRefreshToken, refreshTokenExpiry } from '../../lib/tokens.js';

/**
 * Auth business logic (plan §1, §11). Handles login, refresh-with-rotation, logout.
 * Disabled users are rejected everywhere a token could be minted.
 */
export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Same error for unknown-user and bad-password to limit enumeration.
    if (!user) {
      throw new AppError(ErrorCode.AUTH_INVALID, 'Invalid email or password');
    }
    if (user.status === 'DISABLED') {
      throw new AppError(ErrorCode.USER_DISABLED, 'Account is disabled');
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw new AppError(ErrorCode.AUTH_INVALID, 'Invalid email or password');
    }
    return this.issueTokens(user);
  }

  async refresh(rawToken: string): Promise<LoginResponse> {
    const tokenHash = hashRefreshToken(rawToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record || record.revokedAt || record.expiresAt.getTime() < Date.now()) {
      throw new AppError(ErrorCode.AUTH_INVALID, 'Invalid or expired refresh token');
    }
    if (record.user.status === 'DISABLED') {
      throw new AppError(ErrorCode.USER_DISABLED, 'Account is disabled');
    }

    // Rotate: revoke the presented token, then mint a fresh pair.
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(record.user);
  }

  async logout(rawToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(user: User): Promise<LoginResponse> {
    const accessToken = await signAccessToken(
      { sub: user.id, email: user.email, role: user.role },
      this.config.JWT_ACCESS_SECRET,
      this.config.ACCESS_TOKEN_TTL,
    );

    const rawRefresh = generateRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(rawRefresh),
        expiresAt: refreshTokenExpiry(this.config.REFRESH_TOKEN_TTL_DAYS),
      },
    });

    return {
      accessToken,
      refreshToken: rawRefresh,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }
}
