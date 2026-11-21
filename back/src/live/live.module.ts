import { Body, Controller, Delete, Get, Header, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, Sse, type MessageEvent } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { Observable } from 'rxjs';
import { AccountRequired, AuthUser, ClientIp, CurrentUser, Roles } from '../common/decorators';
import { LiveService, RIDES, type Ride, type RoomKind } from './live.service';
import { REPORT_REASONS, type ReportReason } from './filter';

class PosDto {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-5000)
  @Max(5000)
  x: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-5000)
  @Max(5000)
  z: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-10)
  @Max(10)
  yaw: number;

  /** Véhicule pendant un trajet (absent à pied) : les autres joueurs le voient à bord. */
  @IsOptional()
  @IsIn([...RIDES])
  ride?: Ride;
}
/** Synchronisation d'un onglet : identifiant d'onglet, dernier événement reçu et, facultativement, la position du joueur. */
class SyncDto {
  @Matches(/^[A-Za-z0-9_-]{8,40}$/)
  tab: string;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  ack: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-5000)
  @Max(5000)
  x?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-5000)
  @Max(5000)
  z?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-10)
  @Max(10)
  yaw?: number;

  @IsOptional()
  @IsIn([...RIDES])
  ride?: Ride;
}
class RoomQuery {
  @IsIn(['city', 'place'])
  room: RoomKind;
}
class UserSearchQuery {
  @IsOptional()
  @IsString()
  @MaxLength(21)
  q?: string;
}
class ChatDto {
  @IsIn(['city', 'place'])
  room: RoomKind;

  @IsString()
  @MaxLength(1000)
  text: string;

  /** Message auquel on répond (même salon). */
  @IsOptional()
  @IsUUID('4')
  replyTo?: string;

  /** Identifiant choisi par le client : un réessai après coupure ne publie pas deux fois le même message. */
  @IsOptional()
  @IsUUID('4')
  cid?: string;
}
class DmQuery {
  @IsUUID('4')
  with: string;
}
class DmDto {
  @IsUUID('4')
  to: string;

  @IsString()
  @MaxLength(1000)
  text: string;

  @IsOptional()
  @IsUUID('4')
  replyTo?: string;

  /** Identifiant choisi par le client : un réessai après coupure ne publie pas deux fois le même message. */
  @IsOptional()
  @IsUUID('4')
  cid?: string;
}
class GroupDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsArray()
  @ArrayMaxSize(199)
  @IsUUID('4', { each: true })
  members: string[];
}
class GroupMsgDto {
  @IsString()
  @MaxLength(1000)
  text: string;

  @IsOptional()
  @IsUUID('4')
  replyTo?: string;

  /** Identifiant choisi par le client : un réessai après coupure ne publie pas deux fois le même message. */
  @IsOptional()
  @IsUUID('4')
  cid?: string;
}
class GroupMemberDto {
  @IsUUID('4')
  characterId: string;
}
class ReportDto {
  @IsUUID('4')
  targetId: string;

  @IsOptional()
  @IsUUID('4')
  messageId?: string;

  @IsIn(REPORT_REASONS)
  reason: ReportReason;
}
class ResolveDto {
  @IsIn(['dismiss', 'hide', 'mute'])
  action: 'dismiss' | 'hide' | 'mute';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  muteHours?: number;
}

@Controller('live')
export class LiveController {
  constructor(private readonly live: LiveService) {}

  /**
   * Flux d'événements (SSE) : presence, chat, chat_hidden, ping.
   * En-têtes contre la mise en tampon par un proxy ou un cache (Varnish, Apache, nginx) : sans eux, le flux n'arrive jamais.
   * Pas de limite par IP (un opérateur mobile partage une IP entre de nombreux joueurs) : le hub borne les flux par compte.
   */
  @SkipThrottle()
  @Header('Cache-Control', 'no-cache, no-store, no-transform')
  @Header('X-Accel-Buffering', 'no')
  @Header('Connection', 'keep-alive')
  @Sse('stream')
  stream(@CurrentUser() u: AuthUser): Observable<MessageEvent> {
    return new Observable<MessageEvent>((sub) => {
      let close: (() => void) | null = null;
      let done = false;
      this.live.connect(u.accountId).then(
        (h) => {
          if (done) return h.close();
          close = h.close;
          h.out.subscribe(sub);
          sub.next(h.hello);
        },
        (e: unknown) => sub.error(e),
      );
      return () => {
        done = true;
        close?.();
      };
    });
  }

  // Hors limite par IP (des milliers de joueurs partagent l'IP d'un opérateur) : le hub borne lui-même la cadence par joueur
  @SkipThrottle()
  @HttpCode(200)
  @Post('pos')
  pos(@CurrentUser() u: AuthUser, @Body() dto: PosDto) {
    return this.live.setPosition(u.accountId, dto.x, dto.z, dto.yaw, dto.ride ?? null);
  }

  /**
   * Synchronisation par requêtes courtes : position, événements en attente et présence en une seule requête toutes les
   * 2 à 4 s. Remplace le flux continu sur l'hébergement mutualisé (chaque flux y bloque un processus d'entrée).
   * Hors limite par IP (opérateurs mobiles : une IP pour beaucoup de joueurs) : le hub ignore lui-même les requêtes trop rapprochées.
   */
  @SkipThrottle()
  @HttpCode(200)
  @Post('sync')
  sync(@CurrentUser() u: AuthUser, @Body() dto: SyncDto) {
    const pos = dto.x !== undefined && dto.z !== undefined && dto.yaw !== undefined ? { x: dto.x, z: dto.z, yaw: dto.yaw, ride: dto.ride ?? null } : undefined;
    return this.live.sync(u.accountId, dto.tab, dto.ack, pos);
  }

  /** Présence par requête : sert quand le flux continu (SSE) est bloqué par l'hébergement ; même contenu que l'événement « presence ». */
  @SkipThrottle()
  @Get('presence')
  presence(@CurrentUser() u: AuthUser) {
    return this.live.presenceSnapshot(u.accountId);
  }

  @Get('chat')
  history(@CurrentUser() u: AuthUser, @Query() q: RoomQuery) {
    return this.live.history(u.accountId, q.room);
  }

  @AccountRequired()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('chat')
  post(@CurrentUser() u: AuthUser, @Body() dto: ChatDto) {
    return this.live.post(u.accountId, dto.room, dto.text, dto.replyTo, dto.cid);
  }

  /** « Je suis en train d'écrire » dans un salon : signal éphémère, sans contenu (le client l'envoie au plus toutes les 2 s). */
  @AccountRequired()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post('typing')
  typing(@CurrentUser() u: AuthUser, @Body() dto: RoomQuery) {
    return this.live.typing(u.accountId, dto.room);
  }

  /** Suggestions de pseudos pour « @… » dans le chat. */
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('users')
  users(@CurrentUser() u: AuthUser, @Query() q: UserSearchQuery) {
    return this.live.searchUsers(u.accountId, q.q ?? '');
  }

  @Get('dm')
  dmHistory(@CurrentUser() u: AuthUser, @Query() q: DmQuery) {
    return this.live.dmHistory(u.accountId, q.with);
  }

  @AccountRequired()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('dm')
  dm(@CurrentUser() u: AuthUser, @Body() dto: DmDto) {
    return this.live.dmPost(u.accountId, dto.to, dto.text, dto.replyTo, dto.cid);
  }

  @Get('groups')
  groups(@CurrentUser() u: AuthUser) {
    return this.live.myGroups(u.accountId);
  }

  @AccountRequired()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('groups')
  createGroup(@CurrentUser() u: AuthUser, @Body() dto: GroupDto) {
    return this.live.createGroup(u.accountId, dto.name, dto.members);
  }

  @Get('groups/:id/messages')
  groupHistory(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.live.groupHistory(u.accountId, id);
  }

  @AccountRequired()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('groups/:id/messages')
  groupPost(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: GroupMsgDto) {
    return this.live.groupPost(u.accountId, id, dto.text, dto.replyTo, dto.cid);
  }

  @AccountRequired()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('groups/:id/members')
  addMember(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: GroupMemberDto) {
    return this.live.addGroupMember(u.accountId, id, dto.characterId);
  }

  @HttpCode(200)
  @Delete('groups/:id/members/:characterId')
  removeMember(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Param('characterId', new ParseUUIDPipe({ version: '4' })) characterId: string) {
    return this.live.removeGroupMember(u.accountId, id, characterId);
  }

  @AccountRequired()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('report')
  report(@CurrentUser() u: AuthUser, @Body() dto: ReportDto) {
    return this.live.report(u.accountId, dto);
  }
}

@Roles('ADMIN')
@Controller('admin/reports')
export class ModerationController {
  constructor(private readonly live: LiveService) {}

  @Get()
  list() {
    return this.live.openReports();
  }

  @HttpCode(200)
  @Post(':id/resolve')
  resolve(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: ResolveDto, @ClientIp() ip: string) {
    return this.live.resolve(u.accountId, id, dto.action, dto.muteHours ?? 24, ip);
  }
}

@Module({ controllers: [LiveController, ModerationController], providers: [LiveService], exports: [LiveService] })
export class LiveModule {}
