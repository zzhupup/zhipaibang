const cloudRoom = require('../../utils/cloudRoom.js');
const { CHALLENGES } = require('../../utils/game.js');

/* 自定义模式的挑战牌候选列表（id 1~10，名称+效果说明） */
const CHAL_LIST = Object.keys(CHALLENGES).map(id => ({
  id: +id, name: CHALLENGES[id].name, text: CHALLENGES[id].text, checked: false,
}));

Page({
  data: {
    action: 'create',        // create | join
    roomId: '',
    isHost: false,
    mySeat: -1,
    players: [],
    joinCode: '',
    status: 'lobby',
    gameMode: 'standard',    // standard | advanced | custom（房主选择，写房间文档同步给所有人）
    chalList: CHAL_LIST,     // 自定义模式：挑战牌勾选列表
    customCount: 0,          // 已勾选数量
    roomList: [],            // 可加入的房间列表（加入页）
    listLoading: true,
    minPlayers: cloudRoom.MIN_PLAYERS,   // 开局下限（3）
    maxPlayers: cloudRoom.MAX_PLAYERS,   // 房间上限（8）
    error: '',
    loading: false,
  },

  onLoad(options) {
    cloudRoom.init();
    // 「再来一局」从牌桌回来：复用原房间与玩家身份，直接进入准备页
    if (options.resume && options.roomId && options.pid) {
      this.roomId = options.roomId;
      this.myPlayerId = options.pid;
      this.name = '';
      this.setData({ roomId: this.roomId, action: 'create', loading: false, status: 'lobby' });
      this._hb = cloudRoom.startHeartbeat(this.roomId, this.myPlayerId);
      this.startWatch();
      return;
    }
    this.setData({ action: options.action || 'create' });
    // home 页跳转时 encodeURIComponent 过，必须解码（否则中文昵称存库成 %E7%8E%A9... 乱码）
    this.name = options.name ? decodeURIComponent(options.name) : '玩家';
    if (this.data.action === 'create') this.doCreate();
    else this.startRoomList();   // 加入页：轮询展示可加入的房间
  },

  onUnload() {
    this.stopRoomList();
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

  /* ---------- 可加入房间列表（加入页）---------- */
  startRoomList() {
    this.loadRooms();
    // 每 5 秒刷新一次，新开的房间自动出现
    this._listTimer = setInterval(() => this.loadRooms(), 5000);
  },
  stopRoomList() {
    if (this._listTimer) { clearInterval(this._listTimer); this._listTimer = null; }
  },
  async loadRooms() {
    try {
      const list = await cloudRoom.listRooms();
      this.setData({ roomList: list, listLoading: false });
    } catch (e) {
      console.warn('[room] 房间列表拉取失败', e && (e.errMsg || e.message));
      this.setData({ listLoading: false });
    }
  },
  /* 点击列表中的房间直接加入（满员则提示） */
  onPickRoom(e) {
    const code = e.currentTarget.dataset.code;
    if (!code || this.data.loading) return;
    const item = this.data.roomList.find(r => r.code === code);
    if (item && item.count >= item.max) { wx.showToast({ title: '房间已满', icon: 'none' }); return; }
    this.setData({ joinCode: code });
    this.doJoin(code);
  },

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

  async doJoin(presetCode) {
    const code = String(typeof presetCode === 'string' ? presetCode : (this.data.joinCode || '')).trim();
    if (!/^\d{6}$/.test(code)) { this.setData({ error: '请输入 6 位房间号' }); return; }
    this.setData({ loading: true, error: '' });
    try {
      const { roomId, playerId } = await cloudRoom.joinRoom(code, this.name);
      this.roomId = roomId;
      this.myPlayerId = playerId;
      this.stopRoomList();   // 已进房，停止房间列表轮询
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
    cloudRoom.listPlayers(this.roomId, this.myPlayerId).then(applyList).catch(err => console.warn('[room] 拉取玩家列表失败', err));
    // 实时监听后续增减（传 myId：用心跳自动校准本机时钟，防时钟偏差误过滤他人）
    this.watcher = cloudRoom.watchPlayers(this.roomId, this.myPlayerId, list => {
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
      // 游戏模式同步（房主切换后全员可见）
      if (doc.gameMode && doc.gameMode !== this.data.gameMode) {
        this.setData({ gameMode: doc.gameMode });
      }
      // 自定义挑战牌勾选同步（房主勾选后全员实时可见）
      if (Array.isArray(doc.customChals)) {
        const prev = this.data.chalList.filter(c => c.checked).map(c => c.id).join(',');
        const cur = doc.customChals.join(',');
        if (prev !== cur) {
          const sel = new Set(doc.customChals);
          this.setData({
            chalList: this.data.chalList.map(c => ({ ...c, checked: sel.has(c.id) })),
            customCount: doc.customChals.length,
          });
        }
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

  /* 房主切换 标准/进阶/自定义 模式（写入房间文档，全员实时可见） */
  pickMode(e) {
    if (!this.data.isHost) { wx.showToast({ title: '只有房主可以切换模式', icon: 'none' }); return; }
    const v = e.currentTarget.dataset.v;
    if (v === this.data.gameMode) return;
    this.setData({ gameMode: v });
    cloudRoom.updateRoom(this.roomId, { gameMode: v }).catch(() => {});
  },

  /* 自定义模式：房主勾选/取消挑战牌（多选，写入房间文档同步全员） */
  toggleChal(e) {
    if (!this.data.isHost) { wx.showToast({ title: '只有房主可以勾选', icon: 'none' }); return; }
    const id = +e.currentTarget.dataset.id;
    const sel = new Set(this.data.chalList.filter(c => c.checked).map(c => c.id));
    if (sel.has(id)) sel.delete(id); else sel.add(id);
    const arr = [...sel];
    this.setData({
      chalList: this.data.chalList.map(c => ({ ...c, checked: sel.has(c.id) })),
      customCount: arr.length,
    });
    cloudRoom.updateRoom(this.roomId, { customChals: arr }).catch(() => {});
  },

  async startGame() {
    const list = this.data.players;
    if (list.length < cloudRoom.MIN_PLAYERS) {
      this.setData({ error: `至少需要 ${cloudRoom.MIN_PLAYERS} 位帮众才能开工` });
      return;
    }
    // 关键：联机开局必须用在线玩家列表初始化引擎（此前缺失导致空状态：牌堆52不发牌/无筹码/崩溃）
    // mode 传引擎档位（standard/advanced/custom），自定义需至少勾选 1 张挑战牌
    let mode = this.data.gameMode === 'advanced' ? 'advanced' : 'standard';
    let customChals;
    if (this.data.gameMode === 'custom') {
      customChals = this.data.chalList.filter(c => c.checked).map(c => c.id);
      if (!customChals.length) {
        this.setData({ error: '自定义模式：请至少勾选 1 张挑战牌' });
        return;
      }
      mode = 'custom';
    }
    const game = require('../../utils/game.js');
    game.newGame({ mode, n: list.length, names: list.map(p => p.name), customChals });
    try {
      await cloudRoom.updateRoom(this.roomId, { status: 'playing' });
    } catch (e) {
      // 房主转移后新房主写 rooms 文档被拒 = 集合权限还是"仅创建者可写"
      console.error('[room] 开局写状态失败', e);
      this.setData({ error: '开局失败（权限被拒）：请在云开发控制台把 rooms 集合安全规则改为 write:"auth.openid != null"' });
    }
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
