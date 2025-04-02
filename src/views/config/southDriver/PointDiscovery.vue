<template>
  <emqx-card v-emqx-loading="isLoading">
    <ViewHeaderBar>
      <template v-slot:left>
        <h4 class="page-title">{{ $t('point-discovery.pointDiscovery') }}</h4>
      </template>
      <template v-slot:right>
        <emqx-button type="primary" @click="startDiscovery" :loading="isDiscovering">
          {{ $t('point-discovery.startDiscovery') }}
        </emqx-button>
        <emqx-button type="primary" @click="openAddToGroupDialog" class="ml-10" :disabled="selectedPoints.length === 0">
          {{ $t('point-discovery.addToGroup') }}
        </emqx-button>
        <emqx-button type="primary" class="ml-10" @click="exportPoints" :disabled="discoveredPoints.length === 0">
          {{ $t('point-discovery.exportPointTable') }}
        </emqx-button>
      </template>
    </ViewHeaderBar>

    <div class="device-info-container">
      <div class="device-info">
        <div class="info-item">
          <label>{{ $t('point-discovery.deviceName') }}:</label>
          <span>{{ nodeName }}</span>
        </div>
        <div class="info-item">
          <label>{{ $t('point-discovery.plugin') }}:</label>
          <span>{{ pluginName }}</span>
        </div>
      </div>
    </div>

    <div class="point-discovery-tree-container">
      <!-- 表头区域 -->
      <div class="tree-header">
        <div class="tree-cell">{{ $t('point-discovery.tagName') }}</div>
        <div class="tree-cell">{{ $t('point-discovery.address') }}</div>
        <div class="tree-cell">{{ $t('point-discovery.dataType') }}</div>
      </div>
      
      <!-- 树形结构 -->
      <div v-if="discoveredPoints.length > 0 || !isDiscovering" class="tree-body">
        <ElTree
          ref="treeRef"
          :data="treeData"
          node-key="id"
          show-checkbox
          :props="defaultProps"
          @check="handleTreeCheck"
          @node-click="handleNodeClick"
          :expand-on-click-node="false"
          :default-expand-all="false"
          @node-expand="handleNodeExpand"
          :check-strictly="false"
          :is-leaf="(data: any) => data.tag === 0"
        >
          <template #default="{ node, data }">
            <div class="tree-row" :class="{ 'is-folder': data.tag === 1 }" :data-tag="data.tag">
              <div class="tree-cell">
                <span v-if="data.tag === 1">
                  <i class="el-icon-folder" v-if="!node.expanded" style="color: #e6a23c;"></i>
                  <i class="el-icon-folder-opened" v-else style="color: #e6a23c;"></i>
                  {{ node.label }}
                </span>
                <span v-else>
                  <i class="el-icon-price-tag" style="color: #409EFF;"></i>
                  {{ node.label }}
                </span>
              </div>
              <div class="tree-cell">{{ data.address || extractAddressFromId(data.id) }}</div>
              <div class="tree-cell">{{ data.tag === 0 ? getDataTypeName(data.type) : '' }}</div>
            </div>
          </template>
        </ElTree>
      </div>
      
      <div v-if="isDiscovering" class="discovering-message">
        {{ $t('point-discovery.discoveringPoints') }}
      </div>
      
      <div v-if="discoveredPoints.length === 0 && !isDiscovering" class="empty-message">
        <template v-if="!hasStartedDiscovery">
          {{ $t('point-discovery.clickStartDiscovery') }}
        </template>
        <template v-else>
          <div>
            <p>{{ $t('point-discovery.noPointsDiscovered') }}</p>
            <p v-if="nodeHistory.length === 1" class="opcua-hint">
              <i class="el-icon-info-circle"></i> 
              OPC UA服务器通常有三个根节点：Objects、Types和Views。
              <br>请先点击这些节点进行浏览，您要查找的数据点通常位于 Objects 节点下。
            </p>
          </div>
        </template>
      </div>
    </div>
  </emqx-card>

  <!-- 使用独立的添加点位到采集组对话框组件 -->
  <AddToGroupDialog
    v-model="addToGroupDialogVisible"
    :selected-points="selectedPoints"
    :node-name="nodeName"
    :plugin-name="pluginName"
    @submitted="handleAddToGroupSubmitted"
  />
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, nextTick, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ViewHeaderBar from '@/components/ViewHeaderBar.vue'
import AddToGroupDialog from './components/AddToGroupDialog.vue'
import { ElTree, ElMessage } from 'element-plus'
import http from '@/utils/http'
import { exportExcelData } from '@/utils/utils'
import { useI18n } from 'vue-i18n'
import { TagType } from '@/types/enums'  // 确保导入TagType枚举

// i18n
const { t } = useI18n()

// Route params
const route = useRoute()
const router = useRouter()
const nodeName = computed(() => route.params.node as string)
const pluginName = computed(() => route.params.plugin as string)

// Loading states
const isLoading = ref(false)
const isDiscovering = ref(false)
const hasStartedDiscovery = ref(false)

// Search and filtering
const searchKeyword = ref('')

// Points data
interface DiscoveredPoint {
  id: string
  name: string
  address: string
  type: number
  tag: number // 标记tag值
  attribute?: string
  is_last_layer: boolean
}

interface TreeNode {
  id: string
  label: string
  address: string
  type: number
  tag?: number
  children?: TreeNode[]
  isLeaf?: boolean
  originalPoint?: DiscoveredPoint
}

const discoveredPoints = ref<DiscoveredPoint[]>([])
const selectedPoints = ref<DiscoveredPoint[]>([])
const treeRef = ref<any>(null)

// Tree data and props
const defaultProps = {
  children: 'children',
  label: 'label',
}

// 添加节点历史记录
const nodeHistory = ref<{id: string, name: string}[]>([{id: '', name: 'Root'}])
const currentNodeId = ref('')

// 将点转换为树结构
const treeData = computed(() => {
  // 如果没有发现点位，返回空数组
  if (discoveredPoints.value.length === 0) {
    return []
  }
  
  // 构建当前层级的树结构
  const nodes: TreeNode[] = discoveredPoints.value.map((point) => {
    return {
      id: point.id,
      label: point.name,
      address: point.address,
      type: point.type,
      tag: point.tag, // tag=0表示变量，tag=1表示文件夹/对象
      isLeaf: point.tag === 0, // 变量节点是叶子节点，文件夹节点不是
      children: point.tag === 1 ? [] : undefined, // 如果是文件夹，预设一个空数组
      originalPoint: { ...point }
    }
  })
  
  return nodes
})

// 过滤点位
const filteredPoints = computed(() => {
  if (!searchKeyword.value) {
    return discoveredPoints.value
  }
  const keyword = searchKeyword.value.toLowerCase()
  return discoveredPoints.value.filter(
    (point: DiscoveredPoint) => {
      // 确保address字段存在，即使它是从id提取的
      const addressToCheck = point.address || extractAddressFromId(point.id)
      return point.name.toLowerCase().includes(keyword) || 
             addressToCheck.toLowerCase().includes(keyword)
    }
  )
})

// Group data
const addToGroupDialogVisible = ref(false)

// API Functions
/**
 * 调用点位发现API
 */
const callScanTagsAPI = async (nodeId = '', forTreeBuild = false) => {
  try {
    if (!forTreeBuild) {
      // 在开始时清空已选择的点位
      selectedPoints.value = []
    }
    
    // 构建API参数
    const params = {
      node: nodeName.value,
      id: nodeId,  // 传入节点ID，空字符串表示获取根节点
      ctx: ''  // 上下文可以根据需要添加
    }
    
    // 调用API
    const response = await http.post('/scan/tags', params)
    const data = response.data
    
    // 解析API响应
    if (data.error === 0) {
      // 成功获取点位数据
      if (data.tags && Array.isArray(data.tags)) {
        // 将API返回的点位格式转换为组件需要的格式
        const points: DiscoveredPoint[] = data.tags
          .filter((tag: any) => {
            // 过滤掉类型为UNKNOWN的点位，除非它是文件夹
            return tag.tag === 1 || (tag.tag === 0 && (tag.type !== 255 && tag.type !== undefined))
          })
          .map((tag: any) => ({
            id: tag.id,
            name: tag.name,
            address: tag.address || extractAddressFromId(tag.id), // 使用辅助函数从ID中提取地址
            type: tag.type || 0, // 如果没有类型，默认为BIT
            tag: tag.tag,
            attribute: 'Read', // 默认属性
            is_last_layer: tag.is_last_layer // 是否是最后一层
          }));
        
        if (forTreeBuild) {
          return points; // 如果是构建树，返回点位数据
        } else {
          // 更新当前层级的点位
          discoveredPoints.value = points
          
          // 如果希望默认选中一些点位
          nextTick(() => {
            if (treeRef.value && points.length > 0) {
              // 选中所有点位
              points.forEach((point) => {
                if (point.tag === 0) { // 只选中变量节点，不选中文件夹
                  treeRef.value.setChecked(point.id, true, false)
                }
              })
              updateSelectedPointsFromTree()
            }
          })
        }
      } else {
        if (!forTreeBuild) {
          discoveredPoints.value = []
        } else {
          return [];
        }
      }
    } else {
      // API返回错误
      ElMessage.error(t('common.requestFailed') + ': ' + data.error)
      if (!forTreeBuild) {
        discoveredPoints.value = []
      } else {
        return [];
      }
    }
  } catch (error) {
    ElMessage.error(t('common.requestFailed'))
    if (!forTreeBuild) {
      discoveredPoints.value = []
    } else {
      return [];
    }
  }
  return forTreeBuild ? [] : undefined;
}

// 添加一个辅助函数从ID中提取地址
const extractAddressFromId = (id: string): string => {
  // 如果ID包含感叹号(!),取之后的部分作为地址
  const index = id.indexOf('!');
  if (index !== -1) {
    return id.substring(index + 1);
  }
  // 否则返回原始ID
  return id;
}

// 处理节点展开事件（当点击展开箭头时触发）
const handleNodeExpand = async (data: TreeNode, node: any) => {
  // 仅更新历史记录
  if (!nodeHistory.value.some(item => item.id === data.id)) {
    nodeHistory.value.push({id: data.id, name: data.label});
  }
  currentNodeId.value = data.id;
}

// 处理点击节点
const handleNodeClick = async (data: TreeNode, node: any) => {
  // 只有文件夹节点才展开/折叠
  if (data.tag === 1) {
    // 展开/折叠节点
    node.expanded = !node.expanded;
    
    // 如果是展开操作且子节点为空，加载子节点
    if (node.expanded && (!data.children || data.children.length === 0)) {
      isLoading.value = true;
      try {
        // 获取子节点
        const childPoints = await callScanTagsAPI(data.id, true) as DiscoveredPoint[];
        if (childPoints && childPoints.length > 0) {
          // 构建子节点
          const childNodes: TreeNode[] = childPoints.map((point) => ({
            id: point.id,
            label: point.name,
            address: point.address,
            type: point.type,
            tag: point.tag,
            isLeaf: point.tag === 0, // 变量节点是叶子节点，文件夹节点不是
            children: point.tag === 1 ? [] : undefined,
            originalPoint: { ...point }
          }));
          
          // 更新当前节点的子节点
          data.children = childNodes;
          
          // 等待DOM更新后，处理新加载的节点
          setTimeout(() => {
            setupTreeNodeAttributes();
          }, 100);
        }
      } catch (error) {
        // 错误已由callScanTagsAPI处理
      } finally {
        isLoading.value = false;
      }
    }
    
    // 更新历史记录
    if (node.expanded && !nodeHistory.value.some(item => item.id === data.id)) {
      nodeHistory.value.push({id: data.id, name: data.label});
    }
    currentNodeId.value = data.id;
  } else {
    // 变量节点点击时，仅选中该节点
    treeRef.value.setChecked(data.id, !node.checked, false);
    updateSelectedPointsFromTree();
  }
}

// 导航到上一级
const navigateUp = () => {
  if (nodeHistory.value.length > 1) {
    // 移除当前节点
    nodeHistory.value.pop()
    // 获取上一级节点
    const parentNode = nodeHistory.value[nodeHistory.value.length - 1]
    currentNodeId.value = parentNode.id
    
    // 使用面包屑导航，不需要重新加载数据
    // 只需要更新历史记录即可
  }
}

// 导航到指定层级
const navigateToLevel = (index: number) => {
  if (index >= 0 && index < nodeHistory.value.length) {
    // 保留到指定索引的历史
    nodeHistory.value = nodeHistory.value.slice(0, index + 1)
    const targetNode = nodeHistory.value[index]
    currentNodeId.value = targetNode.id
    
    // 使用面包屑导航，不需要重新加载数据
    // 只需要更新历史记录即可
  }
}

// Functions
const startDiscovery = async () => {
  hasStartedDiscovery.value = true;
  isDiscovering.value = true;
  isLoading.value = true;
  
  // 重置历史记录
  nodeHistory.value = [{id: '', name: 'Root'}];
  currentNodeId.value = '';
  
  try {
    // 调用点位发现API，默认从Root文件夹开始
    const rootPoints = await callScanTagsAPI('', true) as DiscoveredPoint[];
    
    if (rootPoints && rootPoints.length > 0) {
      // 更新树数据
      discoveredPoints.value = rootPoints;
      
      // 等待DOM更新后，处理树节点属性
      setTimeout(() => {
        setupTreeNodeAttributes();
      }, 100);
    } else {
      discoveredPoints.value = [];
    }
  } catch (error) {
    ElMessage.error(t('common.requestFailed'));
    discoveredPoints.value = [];
  } finally {
    isDiscovering.value = false;
    isLoading.value = false;
  }
}

// 处理树选择变化
const handleTreeCheck = () => {
  updateSelectedPointsFromTree()
}

// 根据树选择更新selectedPoints
const updateSelectedPointsFromTree = () => {
  if (!treeRef.value) return
  
  // 获取所有选中的节点，包括父节点选中状态下的子节点
  const checkedNodes = treeRef.value.getCheckedNodes()
  
  // 只选择变量节点（tag === 0），不选择文件夹节点
  const variableNodes = checkedNodes.filter((node: TreeNode) => node.tag === 0)
  
  // 更新选中的点位
  selectedPoints.value = variableNodes
    .filter((node: TreeNode) => node.originalPoint)
    .map((node: TreeNode) => node.originalPoint as DiscoveredPoint)
}

const openAddToGroupDialog = () => {
  // 打开添加到组对话框
  if (selectedPoints.value.length === 0) {
    ElMessage.warning(t('point-discovery.pleaseSelectPoints'))
    return
  }
  addToGroupDialogVisible.value = true
}

const handleAddToGroupSubmitted = () => {
  // 处理添加到组完成后的操作
  ElMessage.success(t('point-discovery.addToGroupSuccess'))
  addToGroupDialogVisible.value = false
}

// 导出点位表
const exportPoints = () => {
  // 检查是否有选中的点位
  if (selectedPoints.value.length === 0) {
    ElMessage.warning(t('point-discovery.pleaseSelectPoints'))
    return
  }
  
  // 准备导出数据，使用二维数组格式 (Array of Arrays)
  // 第一行是表头，使用指定的英文表头
  const headers = [
    'group',
    'interval',
    'name',
    'address',
    'attribute',
    'type',
    'description',
    'decimal',
    'precision',
    'bias'
  ]
  
  // 构建数据行
  const rows = selectedPoints.value
    .filter(point => point.type !== 255) // 过滤掉UNKNOWN类型
    .map(point => [
      '', // group 默认为空
      '', // interval 默认为空
      point.name,
      point.address,
      point.attribute || 'Read',
      getDataTypeName(point.type),
      '', // description 默认为空
      '', // decimal 默认为空
      '', // precision 默认为空
      ''  // bias 默认为空
    ])
  
  // 创建二维数组格式数据，包含表头和行数据
  const exportData = [headers, ...rows]
  
  // 导出Excel，文件名为"设备名 tags"
  exportExcelData(exportData, `${nodeName.value} tags`)
}

onMounted(() => {
  // 页面加载时可以执行的初始化操作
  isLoading.value = true
  
  // 使用引用存储定时器以便清理
  const initialTimer = setTimeout(() => {
    isLoading.value = false
    startDiscovery()
    
    // 添加一个延时来处理树节点的data-tag属性
    const setupTimer = setTimeout(() => {
      // 添加引用检查，确保组件仍然挂载
      if (treeRef.value && treeRef.value.$el) {
        setupTreeNodeAttributes();
      }
    }, 1000);

    // 存储第二个定时器ID以便清理
    onUnmounted(() => {
      clearTimeout(setupTimer);
    });
  }, 500)

  // 在组件卸载时清理资源
  onUnmounted(() => {
    clearTimeout(initialTimer);
  });
})

// 设置树节点属性的函数
const setupTreeNodeAttributes = () => {
  if (!treeRef.value) return;
  
  // 获取所有树节点
  const treeEl = treeRef.value.$el;
  if (!treeEl) return;
  
  // 查找所有行
  const rows = treeEl.querySelectorAll('.tree-row');
  
  // 处理每个节点行
  rows.forEach((row: Element) => {
    const tag = row.getAttribute('data-tag');
    // 找到最近的树节点容器
    const treeNode = row.closest('.el-tree-node');
    if (treeNode && tag) {
      // 设置树节点的data-tag属性
      treeNode.setAttribute('data-tag', tag);
      
      // 如果是变量节点，隐藏展开图标
      if (tag === '0') {
        const expandIcon = treeNode.querySelector('.el-tree-node__expand-icon');
        if (expandIcon && expandIcon instanceof HTMLElement) {
          expandIcon.style.display = 'none';
          expandIcon.style.visibility = 'hidden';
          expandIcon.style.width = '0';
        }
      }
    }
  });
}

// 获取数据类型名称
const getDataTypeName = (typeCode: number) => {
  // 根据typeCode查找对应的TagType名称
  const typeName = Object.keys(TagType)
    .filter(key => !isNaN(Number(key))) // 过滤出数字键
    .find(key => Number(key) === typeCode);
  
  // 如果找到了对应的枚举值，返回它；否则返回'UNKNOWN'
  return typeName ? TagType[typeName as keyof typeof TagType] : 'UNKNOWN';
}
</script>

<style lang="scss" scoped>
.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 500;
  color: #333;
}

.device-info-container {
  margin: 10px 0 20px;
  padding: 12px 16px;
  background-color: #f8f8f8;
  border-radius: 4px;

  .device-info {
    display: flex;
    flex-wrap: wrap;

    .info-item {
      width: 50%;
      margin-bottom: 8px;

      label {
        font-weight: 500;
        margin-right: 8px;
      }
    }
  }
}

.ml-10 {
  margin-left: 10px;
}

.point-discovery-tree-container {
  border: 1px solid #ebeef5;
  border-radius: 4px;
  
  .tree-header {
    display: flex;
    background-color: #f5f7fa;
    border-bottom: 1px solid #ebeef5;
    padding: 12px 0;
    font-weight: 500;
  }
  
  .tree-body {
    max-height: 500px;
    overflow-y: auto;
    
    /* 树节点整体样式 */
    :deep(.el-tree) {
      /* 确保节点内容有足够的空间 */
      .el-tree-node__content {
        height: auto;
        min-height: 34px;
        padding: 0;
      }
      
      /* 确保树的层级结构清晰 */
      .el-tree-node__children {
        padding-left: 18px !important; /* 统一的子节点缩进 */
      }
      
      /* 多层级的树 */
      .el-tree-node .el-tree-node {
        /* 确保每一级都有正确的缩进 */
        .el-tree-node__children {
          margin-left: 0; /* 移除可能的负边距 */
          box-sizing: border-box; /* 确保内边距不会增加元素宽度 */
        }
      }
      
      /* 展开/折叠图标 */
      .el-tree-node__expand-icon {
        padding: 6px;
        font-size: 12px;
        
        /* 展开状态的箭头旋转 */
        &.expanded {
          transform: rotate(90deg);
        }
        
        /* 鼠标悬停效果 */
        &:hover {
          background-color: #f0f0f0;
          border-radius: 50%;
        }
      }
      
      /* 叶子节点不显示展开图标 */
      .el-tree-node.is-leaf .el-tree-node__expand-icon,
      .el-tree-node[data-tag="0"] .el-tree-node__expand-icon {
        visibility: hidden !important;
        display: none !important;
        width: 0 !important;
      }
      
      /* 文件夹节点显示展开图标 */
      .el-tree-node[data-tag="1"] .el-tree-node__expand-icon,
      .el-tree-node:not(.is-leaf) .el-tree-node__expand-icon {
        visibility: visible !important;
        display: inline-block !important;
      }
      
      /* 改善悬停效果 */
      .el-tree-node:not(.is-leaf) > .el-tree-node__content:hover {
        background-color: #f5f7fa;
      }
    }
    
    /* 文件夹和文件图标样式 */
    .el-icon-folder, .el-icon-folder-opened {
      font-size: 18px;
      margin-right: 5px;
    }
    
    .el-icon-price-tag {
      font-size: 16px;
      margin-right: 5px;
    }
  }
  
  .tree-row {
    display: flex;
    width: 100%;
    padding: 10px 0;
    border-bottom: 1px solid #f0f0f0;
    
    &.is-folder {
      font-weight: 500;
    }
  }
  
  .tree-cell {
    flex: 1;
    padding: 0 10px;
    display: flex;
    align-items: center;
    
    &:first-child {
      flex: 1.5;
    }
  }
  
  .discovering-message, .empty-message {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100px;
    font-size: 16px;
    color: #666;
  }
}

.opcua-hint {
  font-size: 14px;
  margin-top: 10px;
  padding: 10px;
  border-radius: 4px;
  background-color: #f0f9eb;
  color: #67c23a;
  text-align: left;
  max-width: 500px;
  margin-left: auto;
  margin-right: auto;
  
  .el-icon-info-circle {
    margin-right: 5px;
  }
}

/* 覆盖之前的样式 */
:deep(.el-tree) {
  /* 隐藏变量节点的展开图标 */
  .el-tree-node[data-tag="0"] > .el-tree-node__content .el-tree-node__expand-icon,
  .tree-row[data-tag="0"] ~ .el-tree-node__expand-icon {
    visibility: hidden !important;
    display: none !important;
    width: 0 !important;
  }
  
  /* 确保文件夹节点显示展开图标 */
  .el-tree-node[data-tag="1"] > .el-tree-node__content .el-tree-node__expand-icon,
  .tree-row[data-tag="1"] ~ .el-tree-node__expand-icon {
    visibility: visible !important;
    display: inline-block !important;
  }
}
</style> 