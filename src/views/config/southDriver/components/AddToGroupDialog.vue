<template>
  <el-dialog
    v-model="showDialog"
    :width="550"
    custom-class="common-dialog"
    :title="$t('config.selectOrCreateGroup')"
    :z-index="2000"
    @close="resetDialogData"
  >
    <div class="dialog-content">
      <!-- 选择已有组的下拉框 -->
      <emqx-select 
        v-model="selectedGroup" 
        class="group-select" 
        :placeholder="$t('config.groupPlaceholder')"
        @change="handleGroupChange"
      >
        <emqx-option 
          v-for="group in availableGroups" 
          :key="group.id" 
          :label="group.name" 
          :value="group.id">
        </emqx-option>
      </emqx-select>
      
      <div v-if="createNewGroup">
        <!-- 组名称输入框 -->
        <div class="form-item required-field">
          <label>{{ $t('config.groupName') }}</label>
          <emqx-input v-model="newGroupName" class="w-full"></emqx-input>
        </div>
        
        <!-- 间隔输入框 -->
        <div class="form-item required-field">
          <label>{{ $t('config.interval') }}</label>
          <div class="interval-input">
            <emqx-input v-model="newGroupInterval" type="number" min="100" class="w-full"></emqx-input>
            <span class="interval-unit">ms</span>
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <span class="dialog-footer">
        <emqx-button @click="showDialog = false" class="cancel-btn">
          {{ $t('common.cancel') }}
        </emqx-button>
        <emqx-button 
          type="primary" 
          @click="addToGroup" 
          :disabled="(createNewGroup && !newGroupName) || (!createNewGroup && !selectedGroup)"
          class="confirm-btn"
        >
          {{ createNewGroup ? $t('config.createNewGroup') : $t('common.confirm') }}
        </emqx-button>
      </span>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from 'vue'
import { ElDialog, ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { queryGroupList } from '@/api/config'

// 用于sessionStorage的键名常量
const DISCOVERY_POINTS_STORAGE_KEY = 'neuron_discovery_points'
const DISCOVERY_FLAG_STORAGE_KEY = 'neuron_from_discovery'

// 定义DiscoveredPoint接口
interface DiscoveredPoint {
  id: string
  name: string
  address: string
  type: number
  tag: number
  is_last_layer: boolean
}

// 组件 props
const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true,
  },
  selectedPoints: {
    type: Array as () => DiscoveredPoint[],
    required: true,
  },
  nodeName: {
    type: String,
    required: true,
  },
  pluginName: {
    type: String,
    required: true,
  },
})

// 组件事件
const emit = defineEmits(['update:modelValue', 'submitted'])

// 路由器实例
const router = useRouter()

// 组数据
interface GroupInfo {
  id: string
  name: string
}

const availableGroups = ref<GroupInfo[]>([])
const selectedGroup = ref('')
const newGroupName = ref('')
const newGroupInterval = ref('2000')
const createNewGroup = ref(true)

// 对话框显示控制
const showDialog = computed({
  get: () => props.modelValue,
  set: (val: boolean) => {
    emit('update:modelValue', val)
  },
})

// 重置对话框数据
const resetDialogData = () => {
  selectedGroup.value = ''
  newGroupName.value = ''
  newGroupInterval.value = '2000'
  createNewGroup.value = true
}

// 选择组时的处理函数
const handleGroupChange = (value: string) => {
  createNewGroup.value = !value
}

// 加载可用的组
const loadGroups = async () => {
  try {
    const groups = await queryGroupList(props.nodeName)
    availableGroups.value = groups.map(group => ({
      id: group.name,
      name: group.name
    }))
  } catch (error) {
    console.error('加载组失败:', error)
    ElMessage.error('加载组列表失败')
  }
}

// 监听对话框打开
watch(showDialog, (val) => {
  if (val) {
    loadGroups()
  }
})

// 添加点位到组
const addToGroup = () => {
  // 确定要使用的组名
  const targetGroupName = createNewGroup.value ? newGroupName.value : selectedGroup.value
  
  // 导航到组编辑页面
  navigateToGroupEditPage(targetGroupName)
  
  // 关闭对话框
  showDialog.value = false
  
  // 重置对话框数据
  resetDialogData()
}

// 导航到组编辑页面
const navigateToGroupEditPage = (groupName: string) => {
  // 准备点位数据，确保包含所有可能需要的字段
  const pointsData = props.selectedPoints.map(point => ({
    name: point.name,
    address: point.address || point.id, // 使用address或id
    type: point.type,
    attribute: 1, // 读取属性
    precision: 0,
    decimal: 0,
    description: '',
    // 添加可能需要的其他字段
    originalId: point.id
  }))
  
  // 使用sessionStorage保存数据，而不是URL参数
  sessionStorage.setItem(DISCOVERY_POINTS_STORAGE_KEY, JSON.stringify(pointsData))
  sessionStorage.setItem(DISCOVERY_FLAG_STORAGE_KEY, 'true')
  
  // 如果是创建新组，也保存间隔值
  if (createNewGroup.value) {
    sessionStorage.setItem('neuron_new_group_interval', newGroupInterval.value)
  }
  
  // 导航到组编辑页面
  router.push({
    name: 'SouthDriverGroupAddTag',
    params: {
      node: props.nodeName,
      plugin: props.pluginName,
      group: groupName
    }
  })
}
</script>

<style lang="scss" scoped>
.dialog-content {
  padding: 10px 0;
  
  .group-select {
    width: 100%;
    margin-bottom: 15px;
  }
  
  .form-item {
    margin-bottom: 15px;
    
    label {
      display: block;
      margin-bottom: 8px;
      font-weight: 500;
    }
    
    &.required-field label::before {
      content: "* ";
      color: #f56c6c;
    }
  }
  
  .interval-input {
    display: flex;
    align-items: center;
    
    .interval-unit {
      margin-left: 8px;
      color: #909399;
      width: 30px;
      text-align: center;
    }
  }
  
  .w-full {
    width: 100%;
  }
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  
  .cancel-btn {
    margin-right: 10px;
  }
}
</style> 