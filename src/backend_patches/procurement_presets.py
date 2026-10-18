"""procurement-presets-v1: national reference definitions; no historical writes."""
from __future__ import annotations
import copy

VERSION = 'national-reference-2026-10-18-v1'
CHECKED_ON = '2026-10-18'
SOURCES = {
    'government': ('中华人民共和国政府采购法（2014年修正）', 'https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_47b5807c40c040368eb5f13b489d6c43.html'),
    'non_tender': ('政府采购非招标采购方式管理办法（财政部令第74号）', 'https://www.mof.gov.cn/gp/xxgkml/tfs/201401/t20140102_2510302.htm'),
    'consultation': ('竞争性磋商采购方式管理暂行办法（财库〔2014〕214号）', 'https://www.mof.gov.cn/gkml/caizhengwengao/wg2015/wg201502/201506/t20150611_1256070.htm'),
    'consultation_extra': ('磋商办法补充通知（财库〔2015〕124号）', 'https://www.mof.gov.cn/gp/xxgkml/gks/201511/t20151102_2511411.htm'),
    'framework': ('政府采购框架协议采购方式管理暂行办法（财政部令第110号）', 'https://dl.mof.gov.cn/tongzhitonggao/202201/t20220128_3785704.htm'),
    'innovation': ('政府采购合作创新采购方式管理暂行办法（财库〔2024〕13号）', 'https://www.mof.gov.cn/jrttts/202404/t20240429_3933787.htm'),
    'bidding': ('中华人民共和国招标投标法（2017年修正）', 'https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_1f79dd79321441a0831f3aed697b4535.html'),
    'central_enterprise': ('规范中央企业采购管理指导意见（国资发改革规〔2024〕53号）', 'https://www.gov.cn/zhengce/zhengceku/202408/content_6966835.htm'),
    'collective': ('中华人民共和国农村集体经济组织法', 'https://fgs.moa.gov.cn/flfg/202409/t20240911_6462349.htm'),
}


def stage(key, name, *modules):
    icons = {'registration': '👥', 'bid_opening': '📂', 'evaluation': '🔍',
             'result_publication': '📢', 'winning_notice': '🏆', 'deposit_refund': '💳', 'archive': '📦'}
    return dict(id=key, name=name, icon=next((icons[m] for m in modules if m in icons), '📋'),
                modules=['common', 'checklist', *modules])


def head():
    return [stage('plan_received', '需求与预算核对'), stage('procurement_approval', '采购方案及适用条件确认'),
            stage('doc_prepare', '采购文件编制', 'responsible_person'), stage('doc_review', '采购文件审核确认')]


def tail(*, notice=True, refund=True):
    return [*([stage('winning_notice', '中标或成交通知书', 'winning_notice')] if notice else []),
            stage('contract_signed', '采购合同签订及公开核对'),
            *([stage('deposit_refund', '保证金退还（收取时适用）', 'deposit_refund')] if refund else []),
            stage('performance_acceptance', '履约与验收登记'), stage('archived', '采购档案归档', 'archive')]


def competitive_flow(announce, response, evaluate, result, *, candidate=False):
    return [*head(), stage('announcement', announce, 'clarification'),
            stage('registration_end', '供应商登记及资格材料核对', 'registration'),
            stage('bid_opening', response, 'bid_opening'), stage('evaluation', evaluate, 'evaluation'),
            *([stage('candidate_publicity', '中标候选人公示及异议处理')] if candidate else []),
            stage('result_announced', result, 'result_publication'), *tail()]


def definitions():
    rows=[]
    def add(key,name,regime,flow,sources,scope,*,minimum=None,kind='national_reference',notes=''):
        rows.append(dict(key=key,method=dict(name=name,regime=regime,enabled=True,template_mode='independent',
            stages=flow,quantity_rule=dict(mode='unfixed' if minimum is None else 'fixed',minimum=minimum),
            exceptions=[],notes=notes),reference=dict(version=VERSION,checked_on=CHECKED_ON,kind=kind,scope=scope,
            sources=[dict(title=SOURCES[s][0],url=SOURCES[s][1]) for s in sources])))
    government='government_procurement'
    common_note='国家参考流程，可结合采购文件调整。数量仅作管理预警；例外条件、适用环节及期限须另行核对，不自动判定废标。'
    add('gov-open','公开招标',government,competitive_flow('招标公告及文件提供','投标文件接收及开标','资格审查与评标','中标结果公告及质疑处理'),
        ['government'],'政府采购货物、服务招标参考；政府采购工程须先核对适用法律。',minimum=3,notes=common_note)
    add('gov-invited','邀请招标',government,competitive_flow('资格条件及投标邀请','投标文件接收及开标','资格审查与评标','中标结果公告及质疑处理'),
        ['government'],'适用于依法符合邀请招标条件的政府采购项目，须先核对适用条件。',minimum=3,notes=common_note)
    add('gov-negotiation','竞争性谈判',government,competitive_flow('谈判邀请及文件提供','响应文件接收及开启','谈判及最后报价评审','成交结果公告及质疑处理'),
        ['government','non_tender'],'货物、服务及依法不必招标的政府采购工程；达到公开招标数额标准时须核对批准程序。',minimum=3,
        notes=common_note+' 财政部令74号第27条规定的两家转谈判等情形，须满足批准等条件，不自动启用数量例外。')
    add('gov-consultation','竞争性磋商',government,competitive_flow('磋商邀请及文件提供','首次响应文件接收及开启','磋商及最后报价综合评审','成交结果公告及质疑处理'),
        ['consultation','consultation_extra'],'按财库〔2014〕214号规定的适用情形核对；不能套用竞争性谈判的最低价成交程序。',minimum=3,
        notes=common_note+' 科研及科技成果转化、政府购买服务等数量例外须按对应条款及采购环节另行核对。')
    add('gov-inquiry','询价',government,competitive_flow('询价邀请及通知书提供','响应文件接收及开启','一次报价及成交候选人评审','成交结果公告及质疑处理'),
        ['government','non_tender'],'适用于符合条件的货物采购，不作为政府采购工程或服务的询价模板。',minimum=3,notes=common_note)
    add('gov-single','单一来源采购',government,[*head(),stage('source_basis','单一来源理由及必要论证'),
        stage('source_publicity','适用时进行单一来源公示及异议处理'),stage('source_approval','适用时办理批准手续'),
        stage('registration_end','特定供应商资料登记','registration'),stage('bid_opening','响应资料接收及核对','bid_opening'),
        stage('evaluation','协商及价格确认','evaluation'),stage('result_announced','成交结果公告','result_publication'),*tail()],
        ['government','non_tender'],'按政府采购法第31条核对理由；公示与批准按第74号令第38条等适用条件办理，非一律要求。',minimum=1,notes=common_note)
    for mode,label in [('closed','封闭式'),('open','开放式')]:
        flow=[*head(),stage('announcement','征集公告及征集文件提供','clarification'),
            stage('registration_end','供应商征集登记','registration'),stage('bid_opening','响应文件接收及开启','bid_opening'),
            stage('evaluation','入围评审及竞争淘汰核对' if mode=='closed' else '加入申请审核及持续征集','evaluation'),
            stage('result_announced','入围结果公告','result_publication'),stage('winning_notice','入围通知及框架协议签订','winning_notice'),
            stage('framework_maintenance','框架协议履行及清退管理'),stage('archived','第一阶段档案归档','archive')]
        add('gov-framework-'+mode,f'框架协议采购（{label}）',government,flow,['framework'],
            f'框架协议第一阶段{label}征集参考，须核对财政部令110号的适用条件。第二阶段合同授予另行建立项目。',
            notes='不固定统一最低数量；按征集类型、淘汰比例及文件核对。开放式不等同于封闭式竞争淘汰。')
    add('gov-framework-second','框架协议采购（第二阶段）',government,[stage('plan_received','采购需求及预算核对'),
        stage('framework_reference','第一阶段协议及入围范围核对'),stage('award_method','合同授予方式及适用条件确认'),
        stage('registration_end','参与合同授予的入围供应商登记','registration'),stage('bid_opening','响应资料接收及核对','bid_opening'),
        stage('evaluation','按约定进行直接选定或竞争评审','evaluation'),stage('result_announced','成交结果及单笔公告核对','result_publication'),
        *tail()],['framework'],'按第一阶段协议约定选择直接选定、二次竞价或顺序轮候等适用方式；并非每单均进行二次竞价。',
        notes='须登记第一阶段协议关联资料。最低供应商数量、单笔公告及汇总公告按适用条款和框架协议确认。')
    add('gov-innovation','合作创新采购',government,[stage('plan_received','创新需求及采购方案核对'),
        stage('announcement','合作创新公告及邀请','clarification'),stage('registration_end','创新供应商登记','registration'),
        stage('concept_exchange','创新概念交流及谈判文件提供'),stage('bid_opening','研发谈判响应接收','bid_opening'),
        stage('evaluation','研发竞争谈判及最后报价评审','evaluation'),stage('result_announced','成交结果公开','result_publication'),
        stage('research_contract','研发合同及首购协议签订'),stage('research_execution','研发实施及阶段评估'),
        stage('research_acceptance','研发验收及首购条件确认'),stage('first_purchase','首购及采购合同履行'),
        stage('archived','研发与首购档案归档','archive')],['innovation'],'针对符合财库〔2024〕13号条件的创新产品研发及首购，不是一般货物服务采购的通用替代方式。',
        notes='研发合同、首购协议、阶段评估及验收分别记录。供应商数量和评审规则按实际研发竞争谈判条件核对。')
    for key,label in [('open','公开招标'),('invited','邀请招标')]:
        add('construction-'+key,label,'mandatory_construction_bidding',competitive_flow(
            '招标公告、资格预审（适用时）及文件提供' if key=='open' else '邀请招标条件核对及投标邀请',
            '投标文件接收及开标','资格审查及评标','定标、中标结果及异议投诉处理',candidate=True),['bidding'],
            '依法必须招标的工程建设项目参考；招标范围、规模标准、资格预审及邀请条件须逐项核对。',minimum=3,
            notes=common_note+' 政府采购工程并不当然适用政府采购货物服务程序；候选人公示与最终中标结果分阶段记录。')
    for key,label,announce,evaluation in [
        ('open','公开招标','招标公告及文件提供','资格审查及评标'),('invited','邀请招标','投标邀请及文件提供','资格审查及评标'),
        ('inquiry','询比采购','询比邀请及文件提供','一次报价及询比评审'),('auction','竞价采购','竞价公告及规则提供','外部竞价及报价结果核对'),
        ('negotiation','谈判采购','谈判邀请及文件提供','分轮谈判及成交评审'),('direct','直接采购','直接采购理由、适用时公示及邀请','商议及价格确认')]:
        add('enterprise-'+key,label,'enterprise',competitive_flow(announce,'响应或投标文件接收',evaluation,'采购结果确认及适用时公开'),
            ['bidding'] if key in ('open','invited') else ['central_enterprise'],
            '管理参考。央企指导意见有专门适用范围，不当然作为所有企业或地方国企的统一法定要求；自愿招标仍须遵守招投标法律。',
            kind='management_reference',notes='按本单位制度和采购文件调整流程、最低数量及公开要求；依法必须招标项目应选对应招标制度。'+
            (' 报价在外部平台进行，本系统登记报价凭证及结果。' if key=='auction' else ''))
    add('collective-general','通用采购（全国参考）','collective',[stage('plan_received','采购需求及预算核对'),
        stage('democratic_decision','章程、民主决策及审批核对'),stage('doc_prepare','采购方案及文件确认'),
        stage('announcement','采购组织及适用时公开','clarification'),stage('registration_end','供应商登记','registration'),
        stage('bid_opening','响应资料接收及核对','bid_opening'),stage('evaluation','评审及择优确认','evaluation'),
        stage('result_announced','采购结果及公开事项核对','result_publication'),*tail()],['collective'],
        '仅全国通用管理参考，不内置地方交易目录、限额、交易平台及公开期限；适用招标法律的项目应选择对应招标制度。',
        kind='management_reference',notes='结合组织章程及重大事项民主决策要求办理；未认定全国统一的采购方式和最低供应商数量。')
    add('other-general','通用采购（管理参考）','other',[stage('plan_received','需求与预算确认'),
        stage('procurement_approval','适用制度、方式及审批确认'),stage('doc_prepare','采购文件或要约准备'),
        stage('registration_end','供应商登记','registration'),stage('bid_opening','响应资料接收','bid_opening'),
        stage('evaluation','商务评审与选择确认','evaluation'),stage('result_announced','采购结果登记','result_publication'),
        *tail()],['government','bidding'],'仅为业务管理参考，不认定政府采购法或招标投标法当然适用；先核对采购主体、标的及资金情况。',
        kind='management_reference',notes='没有统一法定流程或供应商最低数量；按实际适用法律和内部制度配置。')
    return copy.deepcopy(rows)
