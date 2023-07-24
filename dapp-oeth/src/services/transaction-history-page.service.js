export default class TransactionHistoryPageService {
  constructor() {
    this.baseURL = `${process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT}/api/v2/oeth/address`
  }

  async fetchHistory(
    account,
    transactionHistoryItemsPerPage,
    page,
    filters = []
  ) {
    const filter = filters.reduce((result, filter, i) => {
      return `${result}${i !== 0 ? '+' : ''}${filter}`
    }, '')
    const filter_param = filter ? `&filter=${filter}` : ''
    const response = await fetch(
      `${
        this.baseURL
      }/${account.toLowerCase()}/history?per_page=${transactionHistoryItemsPerPage}&page=${page}${filter_param}`
    )

    if (!response || !response.ok) {
      throw new Error('Failed fetching history from analytics')
    }

    return await response.json()
  }
}

export const transactionHistoryPageService = new TransactionHistoryPageService()
