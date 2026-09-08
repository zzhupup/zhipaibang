const poker = require('../../utils/poker.js');
const game = require('../../utils/game.js');
const cloudRoom = require('../../utils/cloudRoom.js');
const { createHostUI } = require('../../utils/onlineHost.js');

const STAGE_W = 980, STAGE_H = 720;
const CX = 490, CY = 360, RX = 390, RY = 278;
const COLOR_ORDER = ['white', 'yellow', 'orange', 'red'];
/* 筹码内 ★ 阵型：1~2 星居中/并排，3 星三角、4 星四方、5 星五边、6 星六边
   坐标为筹码内百分比位置（配合 .starDot 居中偏移） */
const STAR_POS = {
  1: [{ x: 50, y: 50 }],
  2: [{ x: 36, y: 50 }, { x: 64, y: 50 }],
  3: [{ x: 50, y: 24 }, { x: 26, y: 68 }, { x: 74, y: 68 }],
  4: [{ x: 32, y: 32 }, { x: 68, y: 32 }, { x: 68, y: 68 }, { x: 32, y: 68 }],
  5: [{ x: 50, y: 18 }, { x: 81, y: 42 }, { x: 69, y: 79 }, { x: 31, y: 79 }, { x: 19, y: 42 }],
  6: [{ x: 50, y: 14 }, { x: 80, y: 32 }, { x: 80, y: 68 }, { x: 50, y: 86 }, { x: 20, y: 68 }, { x: 20, y: 32 }],
};

Page({
  data: {
    layout: 'round',          // round（宽屏圆桌） | stack（手机竖排）
    scale: 1,
    stageW: STAGE_W, stageH: STAGE_H, stackH: 500,
    playMode: 'single',       // single | host | guest
    heist: 0, vaults: 0, alarms: 0,
    vaultCards: [0, 0, 0], alarmCards: [0, 0, 0],
    phase: 'idle', round: 0,
    roundName: '劫案准备', pillText: '',
    challengeName: '', expertName: '',
    community: [], deckCount: 0, discardCount: 0,
    centerChips: [],
    seats: [],
    mode: 'standard', n: 3,
    mySeat: 0,
    // 弹层
    modal: null,        // 单机/房主：引擎驱动（promise）；客人：本地查看底牌
    pick: null,         // 私密选牌（单机/房主本机）
    guestModal: null,   // 客人：公开/私密提示（声明式，来自 watch）
    guestPick: null,    // 客人：私密选牌
    waitModal: null,    // 客人：他人私密操作提示
    peekModal: null,    // 客人：查看自己的底牌
  },

  onLoad(options) {
    this.mode = options.mode || 'single';          // single | host | guest
    this.roomId = options.roomId || '';
    this.mySeat = options.seat !== undefined ? +options.seat : 0;
    this.setData({ playMode: this.mode, mySeat: this.mySeat });

    let winW = 375, winH = 667;
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      winW = info.windowWidth; winH = info.windowHeight;
    } catch (e) {}
    if (winW >= 700) {
      // 宽屏：圆桌舞台等比缩放
      const scale = Math.max(0.3, Math.min((winW - 4) / STAGE_W, (winH - 210) / STAGE_H));
      this.setData({ layout: 'round', scale, stageW: STAGE_W * scale, stageH: STAGE_H * scale });
    } else {
      // 手机竖屏：毛毡面板 + 座位网格
      this.setData({ layout: 'stack', stackH: winH - 190 });
    }

    if (this.mode === 'single') {
      game.setUI({
        render: () => this.sync(game.getSnapshot()),
        modal: o => this.showModal(o),
        pickHoleCard: (i, prompt, exclude) => this.showPick(i, prompt, exclude),
      });
      game.begin();
    } else if (this.mode === 'host') {
      cloudRoom.init();
      cloudRoom.listPlayers(this.roomId).then(list => {
        this.seatOpenids = list.map(p => p.openid);
        const { ui } = createHostUI({
          page: this, roomId: this.roomId, mySeat: this.mySeat, players: list,
        });
        game.setUI(ui);
        this.watchFeed();
        game.begin();
      }).catch(e => this.toast('初始化失败：' + (e.message || '')));
    } else {
      // 客人：只渲染 + 发送操作
      cloudRoom.init();
      this.shownPromptPid = 0;
      this.watchAsGuest();
    }
  },

  onShow() {
    if (this.mode === 'single' || this.mode === 'host') this.sync(game.getSnapshot());
  },

  onShareAppMessage() {
    return {
      title: '无声劫案 · 正在执行第' + this.data.heist + '次劫案！',
      path: '/pages/home/home',
    };
  },
  onShareTimeline() { return { title: '无声劫案 · 合作扑克劫案' }; },
  toast(t) { wx.showToast({ title: t, icon: 'none' }); },

  /* ================================================================
     渲染（三种模式共用）：输入为 getSnapshot() 形状的快照
     ================================================================ */
  sync(s) {
    const n = s.players.length;
    const color = s.roundColor;
    const isOnline = this.mode !== 'single';
    const seats = s.players.map((p, i) => {
      const ang = (Math.PI / 2) + (i * 2 * Math.PI / n);
      const x = CX + RX * Math.cos(ang);
      const y = CY + RY * Math.sin(ang);
      const chipViews = [];
      COLOR_ORDER.forEach(c => {
        const chip = p.chips[c];
        if (!chip) return;
        const current = s.phase === 'chips' && color === c && !chip.dark;
        chipViews.push({
          id: c, colorCls: c, starPos: STAR_POS[chip.star] || STAR_POS[1],
          dark: !!chip.dark, current,
        });
      });
      // 联机模式：自己的底牌明牌常显
      let myHole = null, myInfo = '';
      if (isOnline && i === this.mySeat) {
        let hole = null;
        if (this.mode === 'host') hole = game.state.players[i].hole;
        else if (this._myHand && this._myHand.hole) hole = this._myHand.hole;
        if (hole && hole.length) {
          myHole = hole.map(c => poker.cardFace(c));
          myInfo = s.community.length >= 3
            ? '当前牌型：' + poker.handName(poker.best5([...hole, ...s.community], p.striker).score)
            : '组合：' + poker.partialHandName(hole);
        }
      }
      let confirmLabel = '', canConfirm = false;
      if (s.phase === 'chips') {
        if (p.confirmed) { confirmLabel = '✔ 已确认'; canConfirm = true; }
        else if (p.hasCurrent) { confirmLabel = '确认'; canConfirm = true; }
        else confirmLabel = '先拿一枚筹码';
      }
      return {
        i, name: p.name, striker: p.striker, msg: p.msg,
        holeCount: p.holeCount, chips: chipViews, myHole, myInfo,
        x: +x.toFixed(1), y: +y.toFixed(1),
        confirmed: p.confirmed, confirmLabel, canConfirm,
        isMe: this.mode !== 'single' && i === this.mySeat,
        canPeek: this.mode === 'single',
      };
    });
    this.setData({
      heist: s.heist, vaults: s.vaults, alarms: s.alarms,
      vaultCards: [0, 1, 2].map(i => i < s.vaults ? 1 : 0),
      alarmCards: [0, 1, 2].map(i => i < s.alarms ? 1 : 0),
      phase: s.phase, round: s.round,
      community: s.community,
      communityViews: (() => {
        const views = [];
        for (let i = 0; i < 5; i++) views.push({ face: s.community[i] || null });
        return views;
      })(), deckCount: s.deckCount, discardCount: s.discardCount,
      centerChips: (s.centerChips || []).map(st => ({ star: st, colorCls: s.roundColor, starPos: STAR_POS[st] || STAR_POS[1] })),
      seats, mode: s.mode, n: s.n,
      challengeName: s.activeChallenge || '', expertName: s.activeExpert || '',
      pillText: this.buildPill(s),
    });
  },
  buildPill(s) {
    if (s.phase === 'chips') return `${s.roundName} · 确认 ${s.confirmedCount}/${s.n}`;
    if (s.phase === 'showdown') return '摊牌中';
    return s.roundName;
  },

  /* ================================================================
     弹窗（单机/房主）：promise 驱动
     ================================================================ */
  showModal(o) {
    return new Promise(resolve => {
      this._modalResolve = resolve;
      this.setData({
        modal: {
          title: o.title || '',
          titleCls: o.titleCls || '',
          body: o.body || '',
          cards: o.cards || null,
          reveal: o.reveal || null,
          actions: (o.actions || [{ label: '确定' }]).map((a, i) => ({
            label: a.label, cls: a.cls || '', idx: i, value: a.value,
          })),
        },
      });
    });
  },
  onModalAction(e) {
    const i = e.currentTarget.dataset.i;
    const action = this.data.modal.actions[i];
    this.setData({ modal: null });
    const r = this._modalResolve;
    this._modalResolve = null;
    if (r) r(action.value);
  },

  showPick(i, prompt, excludeCard) {
    return new Promise(resolve => {
      this._pickResolve = resolve;
      const hole = game.state.players[i].hole;
      const cards = [];
      hole.forEach((c, idx) => {
        if (excludeCard && c === excludeCard) return;
        cards.push({ idx, face: poker.cardFace(c) });
      });
      this.setData({ pick: { title: `🤫 ${game.state.players[i].name} 的私密操作`, prompt, cards } });
    });
  },
  onPickCard(e) {
    const idx = +e.currentTarget.dataset.idx;
    this.setData({ pick: null });
    const r = this._pickResolve;
    this._pickResolve = null;
    if (r) r(idx);
  },
  noop() {},

  /* ================================================================
     桌面交互
     ================================================================ */
  onCenterChip(e) {
    const star = +e.currentTarget.dataset.star;
    if (this.mode === 'guest') {
      cloudRoom.sendAction(this.roomId, { type: 'takeCenter', star, seat: this.mySeat });
      return;
    }
    if (this.mode === 'host') {
      const s = game.state;
      const color = game.ROUND_COLOR[s.round];
      if (s.phase !== 'chips' || !s.centerChips.has(star)) return;
      if (s.players[this.mySeat].chips[color]) return;
      game.doTakeCenter(this.mySeat, star);
      return;
    }
    game.takeCenter(star);
  },
  onSeatChip(e) {
    const target = +e.currentTarget.dataset.i;
    if (this.mode === 'guest') {
      cloudRoom.sendAction(this.roomId, { type: 'takeFrom', target, seat: this.mySeat });
      return;
    }
    if (this.mode === 'host') {
      const s = game.state;
      const color = game.ROUND_COLOR[s.round];
      if (s.phase !== 'chips' || target === this.mySeat) return;
      const t = s.players[target], k = s.players[this.mySeat];
      if (!t.chips[color] || t.chips[color].dark || k.chips[color]) return;
      game.doTakeFrom(this.mySeat, target);
      return;
    }
    game.takeFromPlayer(target);
  },
  onReturn(e) {
    const i = +e.currentTarget.dataset.i;
    if (this.mode === 'guest') {
      if (i === this.mySeat) cloudRoom.sendAction(this.roomId, { type: 'return', seat: this.mySeat });
      return;
    }
    if (this.mode === 'host') { if (i === this.mySeat) game.returnChip(this.mySeat); return; }
    game.returnChip(i);
  },
  onConfirm(e) {
    const i = +e.currentTarget.dataset.i;
    if (this.mode === 'guest') {
      if (i === this.mySeat) cloudRoom.sendAction(this.roomId, { type: 'confirm', seat: this.mySeat });
      return;
    }
    if (this.mode === 'host') { if (i === this.mySeat) game.confirmPlayer(this.mySeat); return; }
    game.confirmPlayer(i);
  },
  onPeek(e) {
    const i = +e.currentTarget.dataset.i;
    if (this.mode === 'single' || (this.mode === 'host' && i === this.mySeat)) {
      game.peekPlayer(i);
      return;
    }
    if (this.mode === 'guest' && i === this.mySeat) {
      this.showGuestPeek();
    }
  },
  /* 客人查看自己的底牌（来自私密文档 watch） */
  showGuestPeek() {
    const hand = this._myHand;
    if (!hand || !hand.hole || !hand.hole.length) { this.toast('底牌尚未发放'); return; }
    const s = this._lastSnap || { community: [] };
    const cards = hand.hole.map(c => poker.cardSpan(c)).join('');
    let info;
    if (s.community.length >= 3) {
      const b = poker.best5([...hand.hole, ...s.community], false);
      info = `你当前的牌型：<b style="color:#e8c15a">${poker.handName(b.score)}</b>（仅供参考，禁止告诉别人）`;
    } else {
      info = `你目前的底牌组合：<b style="color:#e8c15a">${poker.partialHandName(hand.hole)}</b>（仅供参考，禁止告诉别人）`;
    }
    this.setData({
      peekModal: {
        title: '⚠ 查看底牌',
        body: `<div style="background:rgba(214,69,65,.15);border:2rpx solid #d64541;border-radius:12rpx;padding:16rpx;color:#ffd2cd;text-align:center;margin-bottom:16rpx;font-size:28rpx">⚠ 其他玩家请移开视线！</div><div>${cards}</div><div style="margin-top:16rpx;font-size:26rpx;line-height:1.7">${info}</div>`,
      },
    });
  },
  closePeek() { this.setData({ peekModal: null }); },

  onRules() { game.showRules(); },
  onLog() { game.showLog(); },
  onInfo() { game.showRoundInfo(); },
  onRestart() {
    wx.showModal({
      title: '退出对局',
      content: this.mode === 'single' ? '确定要放弃当前对局并返回首页吗？' : '退出后可以重新加入，但对局仍在进行。确定返回首页吗？',
      confirmColor: '#c0524d',
      success: res => { if (res.confirm) wx.navigateBack(); },
    });
  },

  /* ================================================================
     联机 · 房主：监听操作馈送
     ================================================================ */
  watchFeed() {
    this._feedWatcher = cloudRoom.watchActions(this.roomId, async a => {
      try {
        const s = game.state;
        const color = game.ROUND_COLOR[s.round];
        if (a.type === 'prompt' || a.type === 'pick') {
          if (this.hostFeed) this.hostFeed(a);
        } else if (a.type === 'takeCenter') {
          const p = s.players[a.seat];
          if (s.phase === 'chips' && s.centerChips.has(a.star) && !p.chips[color]) {
            game.doTakeCenter(a.seat, a.star);
          }
        } else if (a.type === 'takeFrom') {
          const t = s.players[a.target], k = s.players[a.seat];
          if (s.phase === 'chips' && a.seat !== a.target && t.chips[color] && !t.chips[color].dark && !k.chips[color]) {
            game.doTakeFrom(a.seat, a.target);
          }
        } else if (a.type === 'return') {
          const p = s.players[a.seat];
          if (s.phase === 'chips' && p.chips[color] && !p.chips[color].dark) game.returnChip(a.seat);
        } else if (a.type === 'confirm') {
          if (s.phase === 'chips' && s.players[a.seat].chips[color]) game.confirmPlayer(a.seat);
        }
        await cloudRoom.removeAction(a._id);
      } catch (e) {
        console.error('feed error', e);
      }
    }, e => this.toast('实时连接中断，请重进对局'));
  },

  /* ================================================================
     联机 · 客人：监听房间快照 + 自己的私密文档
     ================================================================ */
  watchAsGuest() {
    // 房间公开快照
    this._roomWatcher = cloudRoom.watchRoom(this.roomId, doc => {
      if (doc.status === 'over') { this.toast('对局已结束'); }
      if (doc.public) {
        this._lastSnap = doc.public;
        this.sync(doc.public);
        this.applyGuestViews(doc.public);
      }
    }, () => this.toast('实时连接中断，请重新加入'));
    // 自己的私密文档（可能尚未创建，重试）
    const tryWatch = (retries) => {
      try {
        this._handWatcher = cloudRoom.watchHand(this.roomId, this.mySeat, doc => {
          this._myHand = doc;
          this.applyGuestViews(this._lastSnap);
        }, () => {
          if (retries > 0) setTimeout(() => tryWatch(retries - 1), 1500);
        });
      } catch (e) {
        if (retries > 0) setTimeout(() => tryWatch(retries - 1), 1500);
      }
    };
    tryWatch(10);
  },
  /* 由 watch 数据声明式推导客人的弹层 */
  applyGuestViews(snap) {
    if (!snap) return;
    const pr = snap.prompt;
    const hp = this._myHand && this._myHand.prompt;
    // 公开提示（全员）或等待他人私密操作
    if (pr && pr.target === 'all') {
      if (this._guestPid !== pr.pid) {
        this._guestPid = pr.pid;
        this.setData({
          guestModal: { title: pr.title, body: pr.body, actions: (pr.actions || [{ label: '确定' }]).map((a, i) => ({ label: a.label, cls: a.cls || '', idx: i, value: a.value })) },
          guestPick: null, waitModal: null,
        });
      }
    } else if (pr && typeof pr.target === 'number' && pr.target !== this.mySeat) {
      if (this._guestPid !== pr.pid) {
        this._guestPid = pr.pid;
        this.setData({
          guestModal: null, guestPick: null,
          waitModal: { title: '⏳ 请稍候', body: `<div style="text-align:center;padding:20rpx;font-size:28rpx">${pr.waitName || '一位帮众'} 正在进行私密操作…</div>` },
        });
      }
    } else if (!pr) {
      if (this._guestPid !== 0) {
        this._guestPid = 0;
        this.setData({ guestModal: null, guestPick: null, waitModal: null });
      }
    }
    // 私密提示（发给我的弹窗 / 私密选牌）
    if (hp && hp.pid) {
      if (this._handPid !== hp.pid) {
        this._handPid = hp.pid;
        if (hp.pickHole) {
          this.setData({ guestModal: null, guestPick: { pid: hp.pid, prompt: hp.prompt, cards: hp.cards } });
        } else {
          this.setData({
            guestModal: { title: hp.title, body: hp.body, actions: (hp.actions || [{ label: '确定' }]).map((a, i) => ({ label: a.label, cls: a.cls || '', idx: i, value: a.value })) },
            guestPick: null, waitModal: null,
          });
        }
      }
    } else if (this._handPid !== 0 && !hp) {
      this._handPid = 0;
      this.setData({ guestPick: null });
    }
  },
  /* 客人点击公开/私密弹窗动作 → 写入操作馈送 */
  onGuestAction(e) {
    const i = e.currentTarget.dataset.i;
    const m = this.data.guestModal;
    if (!m) return;
    const action = m.actions[i];
    cloudRoom.sendAction(this.roomId, { type: 'prompt', pid: this._guestPid, value: action.value, seat: this.mySeat });
    this.setData({ guestModal: null });
  },
  onGuestPick(e) {
    const idx = +e.currentTarget.dataset.idx;
    const gp = this.data.guestPick;
    if (!gp) return;
    cloudRoom.sendAction(this.roomId, { type: 'pick', pid: gp.pid, idx, seat: this.mySeat });
    this.setData({ guestPick: null });
  },

  onUnload() {
    if (this._feedWatcher) this._feedWatcher.close();
    if (this._roomWatcher) this._roomWatcher.close();
    if (this._handWatcher) this._handWatcher.close();
  },
});
