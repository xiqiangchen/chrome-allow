-- chrome-allow watcher
-- 监听 Chrome 原生「要允许远程调试吗？」sheet，并点击「允许」。
-- 不调用 activate，不抢焦点；只匹配该弹窗标题，绝不点「取消」或「在设置中关闭」。
--
-- argv: 1 = mode ("persistent" | "once")
--       2 = timeout seconds (0 = no timeout; persistent 通常为 0)
--       3 = result file path (追加写入 clicked / timeout / error:*)

on run argv
	set mode to item 1 of argv
	set timeoutSeconds to (item 2 of argv) as integer
	set resultPath to item 3 of argv
	set startedAt to current date

	repeat
		if timeoutSeconds > 0 then
			if (current date) - startedAt is greater than or equal to timeoutSeconds then
				recordResult(resultPath, "timeout")
				return "timeout"
			end if
		end if

		try
			tell application "System Events"
				if exists process "Google Chrome" then
					tell process "Google Chrome"
						set windowCount to count of windows
						repeat with windowIndex from 1 to windowCount
							try
								set targetWindow to window windowIndex
								if (count of sheets of targetWindow) > 0 then
									set targetSheet to sheet 1 of targetWindow
									set sheetName to ""
									try
										set sheetName to (name of targetSheet) as string
									end try

									if isConsentSheet(sheetName) then
										set didClick to false
										repeat with element in (entire contents of targetSheet)
											try
												if (role of element) is "AXButton" then
													set label to ""
													try
														set label to (title of element) as string
													end try
													if label is "" then
														try
															set label to (description of element) as string
														end try
													end if

													if label is "允许" or label is "Allow" then
														click element
														recordResult(resultPath, "clicked")
														set didClick to true
														exit repeat
													end if
												end if
											end try
										end repeat

										if didClick then
											if mode is "once" then return "clicked"
											-- 避免同一 sheet 上重复点击
											delay 1
										end if
									end if
								end if
							end try
						end repeat
					end tell
				end if
			end tell
		on error errMsg number errNum
			-- 辅助功能 / Apple Events 权限缺失时直接报错退出，避免静默失效
			if errNum is -1743 or errMsg contains "assistive" or errMsg contains "辅助访问" or errMsg contains "not authorized" then
				recordResult(resultPath, "error:permission")
				return "error:permission"
			end if
			-- 其它瞬态错误（窗口关闭、Chrome 重启）忽略并继续
		end try

		delay 0.5
	end repeat
end run

on isConsentSheet(sheetName)
	if sheetName is "" then return false
	if sheetName contains "远程调试" then return true
	if sheetName contains "remote debugging" then return true
	if sheetName contains "Remote Debugging" then return true
	return false
end isConsentSheet

on recordResult(resultPath, message)
	try
		do shell script "printf '%s\\n' " & quoted form of message & " >> " & quoted form of resultPath
	on error
		-- 结果文件不可写不应阻断监听
	end try
end recordResult
