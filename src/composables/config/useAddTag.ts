import { addTag, addGroup, queryGroupList } from '@/api/config'
import type { TagFormItem, AddTagListForm, GroupForm } from '@/types/config'
import type { Ref } from 'vue'
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { EmqxMessage } from '@emqx/emqx-ui'
import { useI18n } from 'vue-i18n'
import type TagFormCom from '@/views/config/southDriver/components/TagForm.vue'
import { getErrorMsg, popUpErrorMessage } from '@/utils/utils'
import AddTagCommon, { createTagForm } from '@/composables/config/useAddTagCommon'
import { useNodePluginInfo } from './usePluginInfo'

// 用于sessionStorage的键名
const DISCOVERY_POINTS_STORAGE_KEY = 'neuron_discovery_points'
const DISCOVERY_FLAG_STORAGE_KEY = 'neuron_from_discovery'
const NEW_GROUP_INTERVAL_KEY = 'neuron_new_group_interval'

export default () => {
  const route = useRoute()
  const router = useRouter()
  const { t } = useI18n()
  const { createRawTagForm } = createTagForm()

  const { groupName, parseTagData, handleValidTagFormError } = AddTagCommon()

  const tagFormComList: Ref<Array<typeof TagFormCom>> = ref([])
  
  // 标记是否为新创建的组
  const isNewGroup = ref(false)
  // 保存组的间隔值
  const groupInterval = ref<number | null>(null)
  
  // 检查是否从点位发现页面跳转而来
  const isFromDiscovery = computed(() => {
    return sessionStorage.getItem(DISCOVERY_FLAG_STORAGE_KEY) === 'true'
  })
  
  // 初始化tagList，如果有传递过来的点位数据，则使用它们
  const initializeTagList = () => {
    // 从sessionStorage中获取数据，而不是从URL参数
    if (isFromDiscovery.value) {
      try {
        const pointsDataStr = sessionStorage.getItem(DISCOVERY_POINTS_STORAGE_KEY)
        // 获取新组的间隔值（如果有）
        const intervalStr = sessionStorage.getItem(NEW_GROUP_INTERVAL_KEY)
        if (intervalStr) {
          groupInterval.value = parseInt(intervalStr, 10)
          // 当获取到间隔值时，可能是新创建的组
          isNewGroup.value = true
          // 读取后立即清除
          sessionStorage.removeItem(NEW_GROUP_INTERVAL_KEY)
        }
        
        // 使用后立即清除sessionStorage，防止重复使用
        sessionStorage.removeItem(DISCOVERY_POINTS_STORAGE_KEY)
        sessionStorage.removeItem(DISCOVERY_FLAG_STORAGE_KEY)
        
        if (pointsDataStr) {
          const selectedPoints = JSON.parse(pointsDataStr)
          if (Array.isArray(selectedPoints) && selectedPoints.length > 0) {
            // 将selectedPoints转换为TagFormItem格式
            return selectedPoints.map((point, index) => ({
              id: `temp-${index}`, // 临时ID
              name: point.name || '',
              address: point.address || '',
              attribute: point.attribute || 1, // 默认读取属性
              type: point.type || null,
              description: point.description || '',
              precision: point.precision || 0,
              decimal: point.decimal || 0
            }))
          }
        }
      } catch (error) {
        console.error('Failed to parse selectedPoints from sessionStorage:', error)
      }
    }
    
    // 如果没有点位数据或解析失败，返回一个空的表单项
    return [createRawTagForm()]
  }
  
  const tagList: Ref<Array<TagFormItem>> = ref(initializeTagList())
  const formData: Ref<AddTagListForm> = ref({
    tagList: tagList.value,
  })
  const isSubmitting = ref(false)

  const node = computed(() => route.params.node.toString())

  const { nodePluginInfo, getNodePluginInfo } = useNodePluginInfo()

  const tagFormRef = ref()
  const setFormRef = (com: typeof TagFormCom) => {
    if (com) {
      tagFormComList.value.push(com)
    }
  }

  const addTagItem = () => {
    formData.value.tagList.push(createRawTagForm())
  }

  const deleteTagItem = (index: number) => {
    formData.value.tagList.splice(index, 1)
  }

  // 检查组是否已存在，如果不存在则创建
  const checkAndCreateGroupIfNeeded = async () => {
    // 如果可能是新创建的组且有间隔值，则检查组是否已存在
    if (isNewGroup.value && groupInterval.value !== null) {
      try {
        // 获取当前节点下的所有组
        const groups = await queryGroupList(node.value)
        
        // 检查当前组名是否已存在
        const groupExists = groups.some(g => g.name === groupName.value)
        
        // 如果组不存在，则创建
        if (!groupExists) {
          console.log(`Creating new group "${groupName.value}" with interval ${groupInterval.value}ms`)
          
          const groupData: GroupForm = {
            group: groupName.value,
            node: node.value,
            interval: groupInterval.value
          }
          
          // 创建新组
          await addGroup(groupData)
          console.log(`Group "${groupName.value}" created successfully`)
        }
      } catch (error) {
        console.error('Error checking or creating group:', error)
        return Promise.reject(error)
      }
    }
    return Promise.resolve()
  }

  const handlePartialSuc = (errIndex: number, errorNum: number, errorData?: any) => {
    if (errIndex === 0) {
      if (errorNum === 2405) {
        EmqxMessage.error(t('error.addTagByNode2405'))
      } else if (errorNum === 2202) {
        // 点位名称冲突
        if (errorData && errorData.conflict_tags) {
          // 如果API返回了冲突信息
          const conflictTags = errorData.conflict_tags
          let message = t('error.2202') + ': '
          
          if (Array.isArray(conflictTags)) {
            message += conflictTags.map((tag: any) => tag.name).join(', ')
          } else if (typeof conflictTags === 'string') {
            message += conflictTags
          }
          
          EmqxMessage.error(message)
          console.warn('Conflicting tags:', conflictTags)
        } else {
          // 如果API没有返回冲突信息，使用通用错误消息
          EmqxMessage.error(t('error.2202') + ' - ' + t('common.pleaseCheckExistingTags'))
          console.warn('API should return conflict_tags for error 2202')
        }
      } else {
        popUpErrorMessage(errorNum)
      }
      return
    }

    EmqxMessage.error(t('config.tagPartAddedFailedPopup', [getErrorMsg(errorNum)]))
    formData.value.tagList = formData.value.tagList.slice(errIndex)
  }

  const addTags = async () => {
    try {
      // 首先检查并创建组（如果需要）
      await checkAndCreateGroupIfNeeded()
      
      // 然后添加点位
      const tags = await parseTagData(formData.value.tagList)
      await addTag({ tags, node: node.value, group: groupName.value })
      
      return Promise.resolve()
    } catch (error: any) {
      console.error('Error adding tags:', error)
      
      // 处理API返回的错误
      const { data = {} } = error
      
      // 添加更详细的日志记录，帮助调试
      console.log('API error response:', data)
      
      // 检查是否为点位名称冲突(2202)错误
      if (data.error === 2202) {
        // 处理点位名称冲突
        handleTagNameConflict(data)
        return Promise.reject(error)
      }
      
      // 处理其他索引错误
      if (data.error !== 0 && data.index !== undefined) {
        handlePartialSuc(data.index, data.error, data)
      }
      
      return Promise.reject(error)
    }
  }
  
  // 处理点位名称冲突的专用函数
  const handleTagNameConflict = (errorData: any) => {
    // 检查是否返回了冲突的点位信息
    if (errorData.conflict_tags) {
      const conflictTags = errorData.conflict_tags
      let message = t('error.2202') + ': '
      
      if (Array.isArray(conflictTags)) {
        message += conflictTags.map((tag: any) => tag.name).join(', ')
        
        // 在控制台中记录详细信息，帮助开发人员调试
        console.warn('Conflicting tags:', conflictTags)
        
        // 如果有接口信息，也记录下来
        if (errorData.interface) {
          console.info('Interface info:', errorData.interface)
        }
      } else if (typeof conflictTags === 'string') {
        message += conflictTags
      }
      
      // 显示错误消息
      EmqxMessage.error(message)
    } else {
      // 如果API没有返回冲突信息
      EmqxMessage.error(t('error.2202') + ' - ' + t('common.pleaseCheckExistingTags'))
      console.warn('API should return conflict_tags for error 2202 to improve user experience')
      
      // 建议后端开发人员改进API
      console.info('Suggestion: Backend API should return conflict_tags in the error response for error code 2202')
    }
  }

  const validateTagForm = async () => {
    try {
      await tagFormRef.value.validate()
      return Promise.resolve()
    } catch (error) {
      handleValidTagFormError(error)
      return Promise.reject(error)
    }
  }

  const submit = async () => {
    try {
      isSubmitting.value = true
      await validateTagForm()
      await addTags()
      EmqxMessage.success(t('common.createSuccess'))
      router.push({
        name: 'SouthDriverGroupTag',
      })
    } catch (error) {
      console.error(error)
    } finally {
      isSubmitting.value = false
    }
  }

  const cancel = () => {
    router.back()
  }

  // 初始化时获取节点插件信息
  onMounted(() => {
    getNodePluginInfo()
  })
  
  return {
    nodePluginInfo,
    formData,
    isSubmitting,

    createRawTagForm,
    addTagItem,
    deleteTagItem,
    tagFormRef,
    setFormRef,
    cancel,
    submit,
  }
}
