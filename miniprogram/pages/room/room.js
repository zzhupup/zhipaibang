const cloudRoom = require('../../utils/cloudRoom.js');

Page({
  data: {
    action: 'create',        // create | join
    roomId: '',
    isHost: false,
    mySeat: -1,
    players: [],
    joinCode: '',
    status: 'lobby',
    error: '',
    loading: false,
  },

  onLoad(options) {
    cloudRoom.init();
    this.setData({ action: options.action || 'create' });
    this.name = options.name || '玩家';
    if (this.data.action === 'create') this.doCreate();
  },

  onUnload() {
    if (this.watcher) this.watcher.close();
    if (this.roomWatcher) this.roomWatcher.close();
    if (this._hb) this._hb.stop();
    // 页面卸载（含手势返回）= 离开房间；进牌桌的重定向除外
    if (!this._enteringTable && this.roomId && this.myPlayerId) {
      cloudRoom.leaveRoom(this.roomId, this.myPlayerId).catch(() => {});
    }
  },

  onShareAppMessage() {
    return {
      title: `来筹码密语！房间号 ${this.data.roomId}，输入加入对局`,
      path: '/pages/home/home?joinCode=' + this.data.roomId,
    };
  },

  onCode(e) { this.setData({ joinCode: e.detail.value }); },

  async doCreate() {
    this.setData({ loading: true });
    try {
      const { roomId, playerId } = await cloudRoom.createRoom(this.name);
      this.roomId = roomId;
      this.myPlayerId = playerId;   // 身份标识 = 玩家文档 _id（add 不返回 openid，真机已验证）
      this._hb = cloudRoom.startHeartbeat(roomId, playerId);   // 在线心跳
      this.setData({ roomId, isHost: true, mySeat: 0, loading: false });
      this.startWatch();
    } catch (e) {
      this.setData({ error: '创建失败：' + (e.message || e.errMsg || ''), loading: false });
    }
  },

  async doJoin() {
    const code = (this.data.joinCode || '').trim();
    if (!/^\d{6}$/.test(code)) { this.setData({ error: '请输入 6 位房间号' }); return; }
    this.setData({ loading: true, error: '' });
    try {
      const { roomId, playerId } = await cloudRoom.joinRoom(code, this.name);
      this.roomId = roomId;
      this.myPlayerId = playerId;
      this._hb = cloudRoom.startHeartbeat(roomId, playerId);   // 在线心跳
      this.setData({ roomId, isHost: false, loading: false });
      this.startWatch();
    } catch (e) {
      this.setData({ error: e.message || '加入失败', loading: false });
    }
  },

  startWatch() {
    // 立即主动拉一次玩家列表（防止 watch 初始推送为空或异常导致列表空白）
    const applyList = list => {
      if (list && list.length) {
        // 关键：用玩家文档 _id 匹配自己（此前用 openid 匹配，add() 不返回 openid 导致永远匹配不到 → mySeat=-1 → 进桌后暗牌、点不了筹码）
        const me = list.find(p => p.id === this.myPlayerId);
        this.setData({ players: list, mySeat: me ? me.seat : this.data.mySeat });
      }
    };
    cloudRoom.listPlayers(this.roomId).then(applyList).catch(err => console.warn('[room] 拉取玩家列表失败', err));
    // 实时监听后续增减
    this.watcher = cloudRoom.watchPlayers(this.roomId, list => {
      applyList(list);
    }, e => { console.warn('[room] players watch 错误', e); this.setData({ error: '实时连接中断，请重进' }); });
    // 房间状态（开局后自动进入牌桌；文档被删 = 房间解散）
    this.roomWatcher = cloudRoom.watchRoom(this.roomId, doc => {
      if (!doc || !doc.status) {
        wx.showToast({ title: '房间已解散', icon: 'none' });
        this._enteringTable = true;   // 防止 onUnload 再次触发 leaveRoom
        setTimeout(() => wx.navigateBack(), 1200);
        return;
      }
      // 房主转移检测：hostPid 变成自己（前房主离开）
      if (doc.hostPid && doc.hostPid === this.myPlayerId && !this.data.isHost) {
        this.setData({ isHost: true });
        wx.showToast({ title: '房主已离开，你成为新房主', icon: 'none' });
      }
      this.setData({ status: doc.status });
      if (doc.status === 'playing') {
        this._enteringTable = true;
        const mode = this.data.isHost ? 'host' : 'guest';
        wx.redirectTo({
          url: `/pages/table/table?mode=${mode}&roomId=${this.roomId}&seat=${this.data.mySeat}&pid=${this.myPlayerId || ''}`,
        });
      }
    }, e => this.setData({ error: '实时连接中断，请重进' }));
  },

  copyCode() {
    wx.setClipboardData({ data: this.data.roomId });
  },

  async startGame() {
    const list = this.data.players;
    if (list.length < 3) {
      this.setData({ error: '至少需要 3 位帮众才能开工' });
      return;
    }
    // 关键：联机开局必须用在线玩家列表初始化引擎（此前缺失导致空状态：牌堆52不发牌/无筹码/崩溃）
    const game = require('../../utils/game.js');
    game.newGame({ mode: 'online', n: list.length, names: list.map(p => p.name) });
    await cloudRoom.updateRoom(this.roomId, { status: 'playing' });
  },

  backHome() {
    if (!this.roomId || !this.myPlayerId) { wx.navigateBack(); return; }
    wx.showModal({
      title: '退出房间',
      content: this.data.isHost
        ? '退出后房主将自动转交给下一位玩家；若无人剩余，房间自动解散。确定退出吗？'
        : '确定退出该房间吗？',
      confirmColor: '#c0524d',
      success: res => { if (res.confirm) wx.navigateBack(); },
    });
  },
});
