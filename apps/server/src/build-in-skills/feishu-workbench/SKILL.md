---



name: feishu-workbench



description: 工作台助手



---











# 获取交易日历



1.调用接口：



   - 接口地址：http://localhost:18000/api/v1/performance/mock/queryTradeDailyRollEntity?dateTime={target_date}



   -target_date:格式为YYYY-MM-DD，默认为当前日期



接口响应示例：



{



code: 0,



msg: "操作成功",



data: [



{



tradeseqName: "2026年3月30日分时段能量块交易(3月25日组织)",



beginDate: "2026-03-30 00:00:00",



endDate: "2026-03-30 00:00:00",



tradeType: "2",



tradeTypeName: "日滚动",



declareStartTime: "2026-03-25 16:30:00",



declareEndTime: "2026-03-25 17:30:00",



dataTime: "2026-03-25"



}



]



}



# 获取近10个月的交易总览

接口地址：http://localhost:18000/api/v1/performance/mock/getSpotInfo

请求方式：get

请求头：

- Content-Type: application/json

- authorization: 

tIO7BShuUhun2f6q2CFe4mpubUeHztOORoc9Hm8CrT9+gX19MHjGLtAq1btcIqsMV1+bhexlf3zMSz8YQaLCfm+2l0FBSMjvfZqkfxGGyh/SOp9tHlTVMVDsGjrUYLbRfEhamsdQPnq9C4ZPBokTua4c6+7aFFsA5MTQaGUYqHJ/5dDtDkbBIMZaJqS8GI65KsV9aSmmDyXIkuDd2d/cQA==

- user: TMR

响应示例：

{

    "responseType": "json",
    
    "totalSize": 14,
    
    "resultCode": "0",
    
    "pageSize": 10,
    
    "currentPage": 1,
    
    "results": [
    
        {
    
            "dateTime": "2026-03",//月份
    
            "monthAvgPurchasePrice": "332.43",//月平均采购价格
    
            "monthCentralBiddingPrice": "317.62",//月平均竞价价格
    
            "stateGridPurchasePrice": "345.80"//国网代购电价格
    
        }
    
    ]

}